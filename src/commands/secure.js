const {Command, flags} = require('@oclif/command')
const helpers = require('../util/helpers')
const Haikunator = require('haikunator')
const inquirer = require('inquirer')
const yaml = require('js-yaml')
const {cli} = require('cli-ux')
const chalk = require('chalk')
const fs = require('fs-extra')
const path = require('path')
const _ = require('lodash')

const haikunator = new Haikunator()

class SecureCommand extends Command {
  async init() {
    this.rootDomain = 'ahoyworld.io'
    this.caKeyPath = path.join(this.caPath(), 'AhoyCASelfSigned.key')
    this.caPemPath = path.join(this.caPath(), 'AhoyCASelfSigned.pem')
    this.caSrlPath = path.join(this.caPath(), 'AhoyCASelfSigned.srl')
    this.certCommonName = 'Ahoy CA Self Signed CN'
    this.certOrganization = 'Ahoy CA Self Signed Organization'
    this.certRootEmail = 'rootcertificate@' + this.rootDomain

    this.reverseProxy = {
      image: 'jwilder/nginx-proxy',
      ports: ['80:80', '443:443'],
      volumes: [
        '/var/run/docker.sock:/tmp/docker.sock:ro',
        // `/etc/nginx/certs` volume is added dynamically when we know the domain
      ],
    }
  }

  async run() {
    const {args} = this.parse(SecureCommand)
    const {flags} = this.parse(SecureCommand)

    let domain = flags.domain || this.generateRandomDomain() + '.local'
    let composePath = flags['docker-compose']

    // Choose a service
    let service = args.service
    if (!service) {
      let services = _.get(helpers.loadComposeFile(composePath), 'services', [])
      let responses = await inquirer.prompt([{
        name: 'service',
        message: 'Which service should be secured?',
        type: 'list',
        choices: _.map(services, (service, key) => {
          return {name: key}
        }),
      }])
      service = responses.service
    }

    this.log(`Securing ${chalk.green('https://' + domain)} to ${chalk.yellow(service)} with a fresh TLS certificate.`)

    this.createCa()
    await this.createCertificate(domain)
    await this.prepareReverseProxy(composePath, service, domain)

    if (!flags['no-restart']) {
      this.restartDockerCompose(composePath)
    }
  }

  /**
   * Generates a random domain
   *
   * @returns {string}
   */
  generateRandomDomain() {
    return haikunator.haikunate({tokenLength: 2})
  }

  /**
   * Returns the path to the CA certs
   */
  caPath() {
    return path.join(this.config.dataDir, 'ssl/root')
  }

  /**
   * Returns the path to the self-signed domain certs
   */
  certificatesPath(domain) {
    return path.join(this.config.dataDir, `ssl/${domain}`)
  }

  /**
   * Create and trust self-signed CA and root certs
   */
  createCa() {
    if (fs.existsSync(this.caKeyPath) && fs.existsSync(this.caPemPath)) {
      return
    }

    // Remove previous self-signed cert
    helpers.runCommand(
      `sudo security delete-certificate -c "${this.certCommonName}" /Library/Keychains/System.keychain`,
    )

    cli.action.start(chalk.grey('  Creating trusted root certificate'))

    // Prepare the directory structure
    fs.ensureDirSync(this.caPath())

    // Create internal root CA
    helpers.runCommand(`openssl req -new -newkey rsa:2048 -days 730 -nodes -x509 \
      -subj "/C=/ST=/O=${this.certOrganization}/localityName=/commonName=${this.certCommonName}/organizationalUnitName=Developers/emailAddress=${this.certRootEmail}/" \
      -keyout "${this.caKeyPath}" \
      -out "${this.caPemPath}"`)

    // Trust the internal root CA
    helpers.runCommand(
      `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${this.caPemPath}"`,
    )

    cli.action.stop()
  }

  /**
   * Create and trust self-signed certificate for a domain
   */
  async createCertificate(domain) {
    let keyPath = path.join(this.certificatesPath(domain), domain + '.key')
    let csrPath = path.join(this.certificatesPath(domain), domain + '.csr')
    let crtPath = path.join(this.certificatesPath(domain), domain + '.crt')
    let configPath = path.join(this.certificatesPath(domain), domain + '.conf')

    cli.action.start(chalk.grey('  Creating trusted certificate for domain'))

    // Prepare the certificate config file
    let config = await helpers.compileCertificateConfig(domain)

    fs.ensureDirSync(this.certificatesPath(domain))
    fs.writeFileSync(configPath, config, {encoding: 'utf8'})

    // Create a private key
    helpers.runCommand(`openssl genrsa -out "${keyPath}" 2048`)

    // Create signing request
    helpers.runCommand(`openssl req -new \
      -key "${keyPath}" \
      -out "${csrPath}" \
      -subj "/C=/ST=/O=/localityName=/commonName=${domain}/organizationalUnitName=/emailAddress=${domain}@${this.rootDomain}/" \
      -config "${configPath}"`)

    let caSerialParam = `-CAserial '${this.caSrlPath}'`
    if (!fs.existsSync(this.caSrlPath)) {
      caSerialParam += ' -CAcreateserial'
    }

    // Create the certificate
    helpers.runCommand(`openssl x509 -req -sha256 -days 730 \
      -CA "${this.caPemPath}" \
      -CAkey "${this.caKeyPath}" \
      ${caSerialParam} \
      -in "${csrPath}" \
      -out "${crtPath}" \
      -extensions v3_req -extfile "${configPath}"`)

    // Trust the certificate
    helpers.runCommand(`sudo security add-trusted-cert -d -r trustAsRoot -k /Library/Keychains/System.keychain "${crtPath}"`)

    cli.action.stop()
  }

  /**
   * Prepares the reverse proxy and updates the compose file accordingly.
   *
   * @param composePath
   * @param service
   * @param domain
   */
  async prepareReverseProxy(composePath, service, domain) {
    let compose = helpers.loadComposeFile(composePath)

    // Add the certs volume to the reverse proxy
    this.reverseProxy.volumes.push(this.certificatesPath(domain) + ':/etc/nginx/certs')

    // Insert the nginx proxy
    cli.action.start(chalk.grey('  Adding reverse proxy to compose file'))
    compose = this.addNginxProxyService(compose)
    cli.action.stop()

    // Add `VIRTUAL_HOST` to the service
    cli.action.start(chalk.grey('  Assigning virtual host to service'))
    compose = this.addVirtualHostToService(compose, service, domain)
    cli.action.stop()

    // Remove any conflicting ports (replaced by nginx proxy)
    cli.action.start(chalk.grey('  Cleaning up conflicting ports'))
    compose = this.removeConflictingPortsFromService(compose, service)
    cli.action.stop()

    // Prepare and update the compose file
    cli.action.start(chalk.grey('  Updating compose file'))
    compose = await helpers.compileDockerCompose(compose.services).catch(error => {
      this.error(error)
    })
    fs.writeFileSync(composePath, compose, {encoding: 'utf8'})
    cli.action.stop()

    // Add domain to hosts
    cli.action.start(chalk.grey('  Adding domain to hosts file'))
    await this.addHostsDomain(domain)
    cli.action.stop()
  }

  /**
   * Adds the nginx proxy service to the compose file.
   *
   * @param compose
   */
  addNginxProxyService(compose) {
    let services = _.get(compose, 'services', {})
    let reverseProxy = this.reverseProxy

    if (_.has(services, 'reverse-proxy') && services['reverse-proxy'] === reverseProxy) {
      return
    }

    services['reverse-proxy'] = reverseProxy
    compose.services = services

    return compose
  }

  /**
   * Add the `VIRTUAL_HOST` env var to the service
   * so it can be accessed via the reverse proxy
   *
   * @param compose
   * @param service
   * @param domain
   */
  addVirtualHostToService(compose, service, domain) {
    let environment = _.get(compose, `services.${service}.environment`, [])

    if (_.isArray(environment)) {
      // Remove any existing `VIRTUAL_HOST` definition from array
      environment = _.filter(environment, e => e.indexOf('VIRTUAL_HOST=') !== 0)

      // Add the new VIRTUAL_HOST for the domain
      environment.push(`VIRTUAL_HOST=${domain}`)
    } else {
      environment.VIRTUAL_HOST = domain
    }

    // Apply it to the compose
    _.set(compose, `services.${service}.environment`, environment)

    return compose
  }

  /**
   * Removes any conflicting ports from the service and stores them as a label
   *
   * @param compose
   * @param service
   */
  removeConflictingPortsFromService(compose, service) {
    let ports = _.get(compose, `services.${service}.ports`, [])
    let labels = _.get(compose, `services.${service}.labels`, [])
    let conflictingPorts = []

    // Get any conflicting ports
    conflictingPorts = _.filter(ports, port => {
      return _.includes(this.reverseProxy.ports, port)
    })

    // Store any conflicting ports as labels
    if (_.isArray(labels) && !_.isEmpty(ports)) {
      // Extract the previous ports from the label
      let portBackup = _.find(labels, l => l.indexOf('io.ahoyworld.services.ports=') === 0)
      portBackup = _.replace(portBackup, 'io.ahoyworld.services.ports=', '')
      portBackup = portBackup.split(',')

      // Remove the old port backup label
      labels = _.filter(labels, l => l.indexOf('io.ahoyworld.services.ports=') !== 0)

      // Replace it with the new one
      labels.push('io.ahoyworld.services.ports=' + _.uniq(_.merge(portBackup, conflictingPorts)).join(','))
    } else {
      labels['io.ahoyworld.services.ports'] = conflictingPorts.join(',')
    }

    // Update compose
    _.set(compose, `services.${service}.ports`, _.difference(ports, conflictingPorts))
    _.set(compose, `services.${service}.labels`, labels)

    return compose
  }

  /**
   * Adds a given domain to the system hosts file.
   *
   * @param domain
   */
  addHostsDomain(domain) {
    helpers.runCommand(`echo '127.0.0.1 ${domain} # Added by Ahoy (ahoyworld.io)' | sudo tee -a /etc/hosts`)
  }

  // removeHostsDomain(domain) {
  // sudo sed -i".bak" "/whoami.local/d" /etc/hosts
  // }

  /**
   * Restarts the docker-compose services
   */
  restartDockerCompose() {
    cli.action.start(chalk.grey('  Restarting docker compose services'))
    helpers.runCommand('docker-compose rm --stop --force && docker-compose up -d')
    cli.action.stop()
  }
}

SecureCommand.args = [
  {
    name: 'service',
    description: 'service to secure',
  },
]

SecureCommand.flags = {
  domain: flags.string({
    description: 'domain to secure',
  }),
  'no-restart': flags.boolean({
    description: 'disables automatic restart of docker-compose',
    default: false,
  }),
  'docker-compose': flags.string({
    description: 'path to docker-compose.yml file',
    default: 'docker-compose.yml',
  }),
}
SecureCommand.description = 'secure a service with https'

module.exports = SecureCommand
