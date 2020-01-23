const {Command} = require('@oclif/command')
const compile = require('../util/compile')
const Haikunator = require('haikunator')
const child = require('child_process')
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
    let service = 'web'
    let domain = this.generateRandomDomain() + '.local'
    let composePath = 'docker-compose.yml'

    this.log(`Securing ${chalk.green('https://' + domain)} to ${chalk.yellow(service)} with a fresh TLS certificate.`)

    this.createCa()
    this.createCertificate(domain)

    this.prepareReverseProxy(composePath, service, domain)

    // Restart docker compose
    // this.runCommand(`docker-compose restart -f ${composePath}`)
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
    this.runCommand(
      `sudo security delete-certificate -c "${this.certCommonName}" /Library/Keychains/System.keychain`,
    )

    cli.action.start(chalk.grey('  Creating trusted root certificate'))

    // Prepare the directory structure
    fs.ensureDirSync(this.caPath())

    // Create internal root CA
    this.runCommand(`openssl req -new -newkey rsa:2048 -days 730 -nodes -x509 \
      -subj "/C=/ST=/O=${this.certOrganization}/localityName=/commonName=${this.certCommonName}/organizationalUnitName=Developers/emailAddress=${this.certRootEmail}/" \
      -keyout "${this.caKeyPath}" \
      -out "${this.caPemPath}"`)

    // Trust the internal root CA
    this.runCommand(
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
    let config = await compile.compileCertificateConfig(domain)

    fs.ensureDirSync(this.certificatesPath(domain))
    fs.writeFileSync(configPath, config, {encoding: 'utf8'})

    // Create a private key
    this.runCommand(`openssl genrsa -out "${keyPath}" 2048`)

    // Create signing request
    this.runCommand(`openssl req -new \
      -key "${keyPath}" \
      -out "${csrPath}" \
      -subj "/C=/ST=/O=/localityName=/commonName=${domain}/organizationalUnitName=/emailAddress=${domain}@${this.rootDomain}/" \
      -config "${configPath}"`)

    let caSerialParam = `-CAserial = '${this.caSrlPath}'`
    if (fs.existsSync(this.caSrlPath)) {
      caSerialParam += ' -CAcreateserial'
    }

    // Create the certificate
    this.runCommand(`openssl x509 -req -sha256 -days 730 \
      -CA "${this.caPemPath}" \
      -CAkey "${this.caKeyPath}" \
      ${caSerialParam}
      -in "${csrPath}" \
      -out "${crtPath}" \
      -extensions v3_req -extfile "${configPath}"`)

    // Trust the certificate
    this.runCommand(`sudo security add-trusted-cert -d -r trustAsRoot -k /Library/Keychains/System.keychain "${crtPath}"`)

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
    let compose = this.loadComposeFile(composePath)

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

    // Remove ports (replaced by nginx proxy)
    cli.action.start(chalk.grey('  Cleaning up ports'))
    compose = this.removePortsFromService(compose, service)
    cli.action.stop()

    // Prepare the docker-compose.yml file
    compose = compile.compileDockerCompose(compose.services).catch(error => {
      this.error(error)
    })

    // Save the update docker compose
    cli.action.start(chalk.grey('  Updating compose file'))
    fs.writeFileSync(composePath, await compose, {encoding: 'utf8'})
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
   * Removes any ports from the service and stores them as a label
   *
   * @param compose
   * @param service
   */
  removePortsFromService(compose, service) {
    let ports = _.get(compose, `services.${service}.ports`, [])
    let labels = _.get(compose, `services.${service}.labels`, [])
    let conflictingPorts = []

    // Get the conflicting ports (all ports)
    conflictingPorts = _.filter(ports, () => {
      return true
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
   * Loads and parses the docker compose file.
   *
   * @param composePath
   */
  loadComposeFile(composePath) {
    try {
      return yaml.safeLoad(fs.readFileSync(composePath, 'utf8'))
    } catch (error) {
      this.error('Something went wrong. Could not read docker compose file (' + composePath + ')')
    }
  }

  /**
   * Adds a given domain to the system hosts file.
   *
   * @param domain
   */
  addHostsDomain(domain) {
    this.runCommand(`echo '127.0.0.1 ${domain} # Added by Ahoy (ahoyworld.io)' | sudo tee -a /etc/hosts`)
  }

  // removeHostsDomain(domain) {
  // sudo sed -i".bak" "/whoami.local/d" /etc/hosts
  // }

  /**
   * Run a command
   *
   * @param command
   * @param errorCallback
   */
  runCommand(command, errorCallback) {
    try {
      return child.execSync(command, {stdio: 'pipe'}).toString()
    } catch (error) {
      if (errorCallback) {
        errorCallback(error)
      }
    }
  }
}

SecureCommand.args = [
  {
    name: 'service',
    required: false,
    description: 'service to secure',
  },
]

SecureCommand.description = 'secure a service with https'

module.exports = SecureCommand
