const Handlebars = require('handlebars')
const yaml = require('js-yaml')
const fs = require('fs-extra')
const path = require('path')
const _ = require('lodash')

/**
 * Compile `docker-compose.yml` and add to app source
 */
exports.compileDockerCompose = async function (services, templateFile) {
  // Get Dockerfile template
  const source = this.getTemplateFile(templateFile || path.resolve(__dirname, '../../templates/docker-compose.yml'))

  // Register our YAML helper
  Handlebars.registerHelper('yaml', obj => {
    return yaml.safeDump(obj)
  })

  // Prep the handlebars template
  const template = Handlebars.compile(source)

  // Replacement data for handlebars
  const context = {services: services}

  // Compile
  return template(context)
}

/**
 * Grab template file
 */
exports.getTemplateFile = function (templateFile) {
  try {
    return fs.readFileSync(templateFile, 'utf8')
  } catch (error) {
    throw error.message || error.toString()
  }
}
