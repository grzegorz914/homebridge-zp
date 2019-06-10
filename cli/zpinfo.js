#!/usr/bin/env node

// homebridge-zp/cli/zpinfo.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const chalk = require('chalk')
const homebridgeLib = require('homebridge-lib')
const ZpClient = require('../lib/ZpClient')
const ZpListener = require('../lib/ZpListener')
const packageJson = require('../package.json')

const b = chalk.bold
const u = chalk.underline
const usage = `${b('zpinfo')} [${b('-hVlnSs')}] [${b('-t')} ${u('timeout')}] ${u('ip')}`
const help = `Sonos ZonePlayer information.

Print the device description of a Sonos ZonePlayer as JSON.
When run as daemon or service, log Sonos ZonePlayer events as JSON.

Usage: ${usage}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-V')}, ${b('--version')}
  Print version and exit.

  ${b('-d')}, ${b('--daemon')}
  Run as daemon.  Log ZonePlayer events.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-S')}, ${b('--scdp')}
  Include service control point definitions in device description.

  ${b('-s')}, ${b('--service')}
  Run as service.  Log ZonePlayer events, without timestamps.

  ${b('-t')} ${u('timeout')}, ${b('--timeout=')}${u('timeout')}
  Wait for ${u('timeout')} seconds instead of default ${b('15')}.

  ${u('ip')}
  IPv4 address of the zoneplayer.`

class Main extends homebridgeLib.CommandLineTool {
  constructor () {
    super()
    this.usage = usage
    this.options = {
      noWhiteSpace: false,
      timeout: 15
    }
  }

  parseArguments () {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', help)
    parser.version('V', 'version')
    parser.flag('d', 'daemon', () => { this.options.mode = 'daemon' })
    parser.flag('n', 'noWhiteSpace', () => { this.options.noWhiteSpace = true })
    parser.flag('S', 'scdp', () => { this.options.scdp = true })
    parser.flag('s', 'service', (key) => { this.options.mode = 'service' })
    parser.option('t', 'timeout', (value, key) => {
      this.options.timeout = homebridgeLib.OptionParser.toInt(value, 1, 60, true)
    })
    parser.parameter('ip', (value) => {
      this.options.ipAddress = value
    })
    parser.parse()
  }

  async services (device) {
    for (const service of device.serviceList) {
      service.scpd = await this.zpClient.deviceDescription(service.scpdUrl)
    }
  }

  async shutdown (signal) {
    this.log('Got %s, shutting down', signal)
    try {
      if (this.zpClient != null) {
        await this.zpClient.close()
      }
    } catch (error) {
      this.fatal(error)
    }
    process.exit(0)
  }

  async main () {
    try {
      this.parseArguments()

      const jsonOptions = { noWhiteSpace: this.options.noWhiteSpace }
      const jsonFormatter = new homebridgeLib.JsonFormatter(jsonOptions)

      const zpClientOptions = {
        ipAddress: this.options.ipAddress,
        timeout: this.options.timeout
      }
      this.zpClient = new ZpClient(zpClientOptions)
      const description = await this.zpClient.deviceDescription()

      if (this.options.mode) {
        this.setOptions({ mode: this.options.mode })
        process.on('SIGINT', () => { this.shutdown('SIGINT') })
        process.on('SIGTERM', () => { this.shutdown('SIGTERM') })
        this.zpListener = new ZpListener()
        this.zpListener.on('listening', (url) => {
          this.log('listening on %s', url)
        })
        this.zpListener.on('error', (error) => { this.error(error) })
        this.zpClient.on('error', (error) => { this.error(error) })
        this.zpClient.on('event', (device, service, event) => {
          this.log(
            '%s: %s %s event: %s', this.options.ipAddress,
            device, service, jsonFormatter.format(event)
          )
        })
        await this.zpClient.open(this.zpListener)
      } else {
        if (this.options.scdp) {
          await this.services(description.device)
          for (const device of description.device.deviceList) {
            await this.services(device)
          }
        }
        this.print(jsonFormatter.format(description))
      }
    } catch (error) {
      this.fatal(error)
    }
  }
}

new Main().main()
