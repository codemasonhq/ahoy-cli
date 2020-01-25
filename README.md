ahoy
====

Docker development environments

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/ahoy.svg)](https://npmjs.org/package/ahoy)
[![Downloads/week](https://img.shields.io/npm/dw/ahoy.svg)](https://npmjs.org/package/ahoy)
[![License](https://img.shields.io/npm/l/ahoy.svg)](https://github.com/codemasonhq/ahoy/blob/master/package.json)

<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g ahoy
$ ahoy COMMAND
running command...
$ ahoy (-v|--version|version)
ahoy/1.0.1 darwin-x64 node-v12.9.1
$ ahoy --help [COMMAND]
USAGE
  $ ahoy COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`ahoy help [COMMAND]`](#ahoy-help-command)
* [`ahoy install PACK`](#ahoy-install-pack)
* [`ahoy plugins`](#ahoy-plugins)
* [`ahoy plugins:install PLUGIN...`](#ahoy-pluginsinstall-plugin)
* [`ahoy plugins:link PLUGIN`](#ahoy-pluginslink-plugin)
* [`ahoy plugins:uninstall PLUGIN...`](#ahoy-pluginsuninstall-plugin)
* [`ahoy plugins:update`](#ahoy-pluginsupdate)
* [`ahoy secure [SERVICE]`](#ahoy-secure-service)
* [`ahoy unsecure`](#ahoy-unsecure)

## `ahoy help [COMMAND]`

display help for ahoy

```
USAGE
  $ ahoy help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v2.2.3/src/commands/help.ts)_

## `ahoy install PACK`

install a language pack

```
USAGE
  $ ahoy install PACK

ARGUMENTS
  PACK  language pack to use

OPTIONS
  -o, --options    choose from available services to import
  -w, --with=with  specify services to import from the language pack
```

_See code: [src/commands/install.js](https://github.com/codemasonhq/ahoy/blob/v1.0.1/src/commands/install.js)_

## `ahoy plugins`

list installed plugins

```
USAGE
  $ ahoy plugins

OPTIONS
  --core  show core plugins

EXAMPLE
  $ ahoy plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v1.7.9/src/commands/plugins/index.ts)_

## `ahoy plugins:install PLUGIN...`

installs a plugin into the CLI

```
USAGE
  $ ahoy plugins:install PLUGIN...

ARGUMENTS
  PLUGIN  plugin to install

OPTIONS
  -f, --force    yarn install with force flag
  -h, --help     show CLI help
  -v, --verbose

DESCRIPTION
  Can be installed from npm or a git url.

  Installation of a user-installed plugin will override a core plugin.

  e.g. If you have a core plugin that has a 'hello' command, installing a user-installed plugin with a 'hello' command 
  will override the core plugin implementation. This is useful if a user needs to update core plugin functionality in 
  the CLI without the need to patch and update the whole CLI.

ALIASES
  $ ahoy plugins:add

EXAMPLES
  $ ahoy plugins:install myplugin 
  $ ahoy plugins:install https://github.com/someuser/someplugin
  $ ahoy plugins:install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v1.7.9/src/commands/plugins/install.ts)_

## `ahoy plugins:link PLUGIN`

links a plugin into the CLI for development

```
USAGE
  $ ahoy plugins:link PLUGIN

ARGUMENTS
  PATH  [default: .] path to plugin

OPTIONS
  -h, --help     show CLI help
  -v, --verbose

DESCRIPTION
  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello' 
  command will override the user-installed or core plugin implementation. This is useful for development work.

EXAMPLE
  $ ahoy plugins:link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v1.7.9/src/commands/plugins/link.ts)_

## `ahoy plugins:uninstall PLUGIN...`

removes a plugin from the CLI

```
USAGE
  $ ahoy plugins:uninstall PLUGIN...

ARGUMENTS
  PLUGIN  plugin to uninstall

OPTIONS
  -h, --help     show CLI help
  -v, --verbose

ALIASES
  $ ahoy plugins:unlink
  $ ahoy plugins:remove
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v1.7.9/src/commands/plugins/uninstall.ts)_

## `ahoy plugins:update`

update installed plugins

```
USAGE
  $ ahoy plugins:update

OPTIONS
  -h, --help     show CLI help
  -v, --verbose
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v1.7.9/src/commands/plugins/update.ts)_

## `ahoy secure [SERVICE]`

secure a service with https

```
USAGE
  $ ahoy secure [SERVICE]

ARGUMENTS
  SERVICE  service to secure
```

_See code: [src/commands/secure.js](https://github.com/codemasonhq/ahoy/blob/v1.0.1/src/commands/secure.js)_

## `ahoy unsecure`

Describe the command here

```
USAGE
  $ ahoy unsecure

OPTIONS
  -n, --name=name  name to print

DESCRIPTION
  ...
  Extra documentation goes here
```

_See code: [src/commands/unsecure.js](https://github.com/codemasonhq/ahoy/blob/v1.0.1/src/commands/unsecure.js)_
<!-- commandsstop -->
