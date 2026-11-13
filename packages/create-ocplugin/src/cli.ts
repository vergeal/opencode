#!/usr/bin/env bun
import { generate, Templates, type Template } from "./generate.js"

const usage = `Usage: create-ocplugin <directory> [options]

Creates an OpenCode plugin inside this repository. The directory must sit under
packages/, because the generated package uses workspace:* and catalog: versions.

Options:
  -t, --template <server|gui|tui>  parts to scaffold (default: server)
  -n, --name <label>               display name (default: derived from the directory)
  -h, --help                       show this message
`

/** One parse of the arguments: a usage error carries the message to print with the help. */
function parse(argv: readonly string[]) {
  const options: { directory?: string; template: Template; name?: string; help: boolean } = {
    template: "server",
    help: false,
  }

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (argument === "-h" || argument === "--help") {
      options.help = true
      continue
    }

    const [flag, inline] = argument.split("=", 2)
    if (flag === "-t" || flag === "--template") {
      const value = inline ?? argv[++index]
      if (!value) throw new UsageError("--template needs a value")
      if (!Templates.includes(value as Template))
        throw new UsageError(`Unknown template "${value}". Expected one of: ${Templates.join(", ")}.`)
      options.template = value as Template
      continue
    }
    if (flag === "-n" || flag === "--name") {
      const value = inline ?? argv[++index]
      if (!value) throw new UsageError("--name needs a value")
      options.name = value
      continue
    }
    if (argument.startsWith("-")) throw new UsageError(`Unknown option "${argument}".`)
    if (options.directory) throw new UsageError(`Unexpected argument "${argument}".`)

    options.directory = argument
  }

  if (!options.help && !options.directory) throw new UsageError("A target directory is required.")
  return options
}

class UsageError extends Error {}

async function main(argv: readonly string[]) {
  const options = parse(argv)
  if (options.help) {
    process.stdout.write(usage)
    return
  }

  const selected = await generate({
    directory: options.directory!,
    template: options.template,
    ...(options.name ? { name: options.name } : {}),
  })

  process.stdout.write(`Created ${selected.id} in ${selected.directory}\n`)
  for (const file of selected.files) process.stdout.write(`  ${file}\n`)
  process.stdout.write(`\nNext: cd ${selected.directory} && bun run typecheck\n`)
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${usage}`)
    process.exit(1)
  }

  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
