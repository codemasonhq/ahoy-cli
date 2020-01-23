const {Command, flags} = require('@oclif/command')
const compile = require('../util/compile')
const download = require('download-git-repo')
const inquirer = require('inquirer')
const yaml = require('js-yaml')
const {cli} = require('cli-ux')
const chalk = require('chalk')
const fs = require('fs-extra')
const path = require('path')
const _ = require('lodash')

class InstallCommand extends Command {
  async run() {
    const {args} = this.parse(InstallCommand)
    const {flags} = this.parse(InstallCommand)

    const pack = await this.resolvePack(args.pack).catch(error => {
      this.error(error)
    })

    // Load the manifest file for the language pack
    const manifest = await this.loadManifest(pack.path)

    // Let the user choose which services they want
    let withFlag = flags.with
    if (flags.options) {
      let responses = await inquirer.prompt([{
        name: 'options',
        message: 'Choose services to import',
        type: 'checkbox',
        choices: _.map(manifest.available, s => {
          return {name: s}
        }),
      }])
      withFlag = responses.options.join(',')
    }

    // Tell the user
    this.log(`Crafting ${chalk.green(manifest.name)} application with ${chalk.green(this.getServiceList(manifest, withFlag).join(', '))}`)

    // Load the Dockerfile's
    await this.loadBuildFiles(pack.path)

    // Load the services yaml from the language pack
    await this.loadServices(manifest, pack.path, withFlag)
  }

  /**
   * Fetches the language pack. Detects if a
   * pack is an official, custom or local pack.
   */
  async resolvePack(pack) {
    if (fs.existsSync(pack)) {
      return {
        type: 'local',
        path: pack,
      }
    }

    // No slash means use official
    var isOfficial = (pack.indexOf('/') === -1)

    // Prepare the repo url to retrieve the language pack from
    var repo = isOfficial ? 'codemasonhq/ahoy-install-' + pack : pack

    // Download the language pack
    const path = await this.download(repo)

    return {
      type: isOfficial ? 'official' : 'custom',
      path: path,
    }
  }

  /**
   * Download the craft kit from a git repo
   */
  download(repo) {
    return new Promise(function (resolve, reject) {
      const tmpPath = '/tmp/ahoy/ahoy-install-' + Math.random().toString(35).substr(2, 7)

      try {
        download(repo, tmpPath, function (error) {
          if (error) reject('Failed to download repo ' + repo + ': ' + error.message.trim()) // eslint-disable-line prefer-promise-reject-errors
          resolve(tmpPath)
        })
      } catch (error) {
        throw ('Could not find language pack.') // eslint-disable-line no-throw-literal
      }
    })
  }

  /**
   * Load ahoy manifest file of a language pack
   */
  loadManifest(packPath) {
    try {
      return yaml.safeLoad(fs.readFileSync(path.join(packPath, 'ahoy.yml'), 'utf8'))
    } catch (error) {
      this.error('Something went wrong. Could not load language pack.')
    }
  }

  /**
   * Imports the Dockerfile's in the `builds` directory
   */
  async loadBuildFiles(packPath) {
    let files = []

    try {
      files = fs.readdirSync(path.join(packPath, 'builds/'))
    } catch (error) {
      this.warn('This language pack doesn\'t contain any Dockerfile\'s.')
    }

    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      await this.confirmAndWriteFile(file, fs.readFileSync(path.join(packPath, `builds/${file}`), 'utf8'))
    }
  }

  /**
   * Load the chosen service templates
   */
  async loadServices(manifest, packPath, withFlag) {
    let services = {}
    let warnings = []

    // Get the default list of services to load
    let serviceList = this.getServiceList(manifest, withFlag)

    // Load the files for each selected service
    _.each(serviceList, service => {
      try {
        let data = yaml.safeLoad(fs.readFileSync(path.join(packPath, `services/${service}.yml`), 'utf8'))
        services[Object.keys(data)] = data[Object.keys(data)]
      } catch (error) {
        warnings.push(`Unknown service ${service} in ${manifest.name} pack, skipped...`)
      }
    })

    // Prepare the docker-compose.yml file
    const dockerCompose = await compile.compileDockerCompose(services).catch(error => {
      this.error(error)
    })

    // Write the docker-compose.yml file
    let writeFile = await this.confirmAndWriteFile('docker-compose.yml', dockerCompose)

    if (writeFile) {
      // Output any warnings
      warnings.map(warning => this.warn(warning))
    }
  }

  /**
   * Return a list of the selected services
   */
  getServiceList(manifest, withFlag) {
    let serviceList = manifest.default

    // When the --with flag is provided, use that
    if (!_.isEmpty(withFlag)) {
      serviceList = _.map(withFlag.split(','), _.trim)
    }

    // Convert a --with string to an array
    if (typeof serviceList === 'string') {
      serviceList = _.map(serviceList.split(','), _.trim)
    }

    return serviceList
  }

  /**
   * Prompt for overwrite confirmation if required
   * and write the generated file to user disk
   */
  async confirmAndWriteFile(filename, contents) {
    let writeFile = true

    if (fs.existsSync(filename)) { // Confirm should overwrite
      const overwrite = await cli.prompt(`Overwrite existing ${filename} file? [yes/no]`, {default: 'no'})
      switch (overwrite) {
      case 'yes':
      case 'y':
        writeFile = true
        break

      case 'no':
      case 'n':
        writeFile = false
        break
      }
    }

    if (writeFile) {
      this.writeFile(filename, contents)
    }

    return writeFile
  }

  /**
   * Write file to file system
   */
  writeFile(filename, contents) {
    try {
      fs.writeFileSync(filename, contents, {encoding: 'utf8'})
      this.log(chalk.grey(`... Wrote ${filename}`))
    } catch (error) {
      this.error(`Could not write ${filename}: (${error.message || error.toString()})`)
    }
  }
}

InstallCommand.args = [
  {
    name: 'pack',
    required: true,
    description: 'language pack to use',
  },
]

InstallCommand.flags = {
  options: flags.boolean({
    char: 'o',
    description: 'choose from available services to import',
    default: false,
  }),
  with: flags.string({
    char: 'w',
    description: 'specify services to import from the language pack',
  }),
}

InstallCommand.description = 'install a language pack'

module.exports = InstallCommand
