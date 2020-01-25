const {Command, flags} = require('@oclif/command')
const helpers = require('../util/helpers')
const {cli} = require('cli-ux')
const chalk = require('chalk')
const fs = require('fs-extra')
const _ = require('lodash')

class UnsecureCommand extends Command {
  async init() {
    this.rootDomain = 'ahoyworld.io'
  }

  async run() {
    const {args} = this.parse(UnsecureCommand)
    const {flags} = this.parse(UnsecureCommand)

    this.log('Restoring the standard HTTP environment')

    let composePath = flags['docker-compose']
    let domains = (args.domain || this.getDomainsFromCompose(composePath)).split(',')
    let compose = helpers.loadComposeFile(composePath)

    _.each(_.filter(domains), async domain => {
      this.log()
      this.log(`Disconnecting ${chalk.green('https://' + domain)}`)

      // Delete certs based on domain
      await this.deleteCertificate(domain)

      // Delete domain from hosts file
      await this.removeHostsDomain(domain)
    })

    // Revert docker compose ports back to original
    cli.action.start(chalk.grey('  Restoring ports from backup label'))
    compose = this.restoreConflictingPortsFromService(compose)
    cli.action.stop()

    // Remove `VIRTUAL_HOST` from services
    cli.action.start(chalk.grey('  Dropping virtual host from services'))
    compose = this.removeVirtualHostFromServices(compose)
    cli.action.stop()

    // Remove proxy service from compose
    cli.action.start(chalk.grey('  Removing reverse proxy from compose file'))
    compose = this.removeReverseProxyService(compose)
    cli.action.stop()

    // Prepare and update the compose file
    cli.action.start(chalk.grey('  Updating compose file'))
    compose = await helpers.compileDockerCompose(compose.services).catch(error => {
      this.error(error)
    })
    fs.writeFileSync(composePath, compose, {encoding: 'utf8'})
    cli.action.stop()
  }

  /**
   * Get any `VIRTUAL_HOST` domains from compose file
   *
   * @param composePath
   * @returns {string}
   */
  getDomainsFromCompose(composePath) {
    let services = _.get(helpers.loadComposeFile(composePath), 'services', [])

    let domains = _.map(services, service => {
      let environment = _.get(service, 'environment', [])

      if (_.isArray(environment)) {
        return environment.join(',').replace('VIRTUAL_HOST=', '')
      }

      return environment.VIRTUAL_HOST
    })

    return _.filter(domains).join(',')
  }

  /**
   * Deletes a trusted self-signed certificate for a domain
   *
   * @param domain
   */
  deleteCertificate(domain) {
    cli.action.start(chalk.grey('  Removing trusted certificates'))
    helpers.runCommand(`sudo security delete-certificate -c "${domain}" /Library/Keychains/System.keychain`)
    helpers.runCommand(`sudo security delete-certificate -c "*.${domain}" /Library/Keychains/System.keychain`)
    helpers.runCommand(`sudo security find-certificate -e "${domain}@${this.rootDomain}" -a -Z | grep SHA-1 | sudo awk '{system("security delete-certificate -Z '$NF' /Library/Keychains/System.keychain")}'`)
    cli.action.stop()
  }

  /**
   * Removes a given domain to the system hosts file.
   *
   * @param domain
   */
  removeHostsDomain(domain) {
    cli.action.start(chalk.grey('  Dropping domain from hosts file'))
    helpers.runCommand(`sudo sed -i".bak" "/${domain}/d" /etc/hosts`)
    cli.action.stop()
  }

  /**
   * Restores any ports that were moved due to conflicts with the reverse proxy.
   *
   * @param compose
   * @returns {undefined}
   */
  restoreConflictingPortsFromService(compose) {
    let services = _.get(compose, 'services', [])

    _.each(services, (service, key) => {
      let ports = _.get(compose, 'ports', [])
      let labels = _.get(service, 'labels', [])

      // Get the previous conflicting ports
      let portBackup = _.find(labels, l => l.indexOf('io.ahoyworld.services.ports=') === 0)
      portBackup = _.replace(portBackup, 'io.ahoyworld.services.ports=', '')
      portBackup = portBackup.split(',')

      // Update the compose
      _.set(compose, `services.${key}.ports`, _.difference(portBackup, ports))
      _.set(compose, `services.${key}.labels`, _.filter(labels, l => l.indexOf('io.ahoyworld.services.ports=') !== 0))
    })

    return compose
  }

  /**
   * Remove virtual host from services.
   *
   * @param compose
   * @param service
   * @param domain
   */
  removeVirtualHostFromServices(compose) {
    let services = _.get(compose, 'services', [])

    _.each(services, (service, key) => {
      let environment = _.get(compose, 'environment', [])

      // Remove any existing `VIRTUAL_HOST` definition
      if (_.isArray(environment)) {
        environment = _.filter(environment, e => e.indexOf('VIRTUAL_HOST=') !== 0)
      } else {
        delete environment.VIRTUAL_HOST
      }

      // Apply it to the compose
      _.set(compose, `services.${key}.environment`, environment)
    })

    return compose
  }

  /**
   * Removes the reverse proxy service from the compose
   *
   * @param compose
   */
  removeReverseProxyService(compose) {
    delete compose.services['reverse-proxy']
    return compose
  }
}

UnsecureCommand.args = [
  {
    name: 'domain',
    required: false,
    description: 'domain to unsecure',
  },
]

UnsecureCommand.flags = {
  'docker-compose': flags.string({
    description: 'path to docker-compose.yml file',
    default: 'docker-compose.yml',
  }),
}

UnsecureCommand.description = 'unsecure a service'

module.exports = UnsecureCommand
