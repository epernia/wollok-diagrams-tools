#!/usr/bin/env node
/*
 * wolloksd2drawio — genera el diagrama de clases en formato draw.io (diagrams.net)
 * a partir de codigo Wollok. Al regenerarlo, las cajas conservan donde las dejaste.
 *
 *   node tools/wolloksd2drawio/cli.mjs src/ladrones.wlk -o docs/ladrones.drawio
 *   node tools/wolloksd2drawio/cli.mjs src/ladrones.wlk -o docs/ladrones.drawio --eslang
 *
 * Las opciones estan en help.mjs (o con --help). La otra salida posible es
 * PlantUML: ver tools/wolloksd2puml.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { runGenerator, provenanceOf } from '../wollok-uml/generator.mjs'
import { messagesFor } from '../wollok-uml/i18n.mjs'
import { renderDrawio, readGeometry } from './render.mjs'
import { HELP } from './help.mjs'

/** Lo que este modulo le dice al usuario. Mismas claves en los dos idiomas. */
const MESSAGES = {
	en: {
		keptPositions: (count) => `(I kept the position of ${count} box(es) from the previous file)`,
		blockedArrows: (count) => `${count} arrow(s) without a clear path (some box is in the way):`,
		crowdedBoxes: (count) => `${count} box(es) kept their place but got wider, and now crowd a neighbour (regenerate with --relayout to lay them out again):`,
	},
	es: {
		keptPositions: (count) => `(conservo la posicion de ${count} caja(s) del archivo anterior)`,
		blockedArrows: (count) => `${count} flecha(s) sin camino libre (alguna caja tapa el paso):`,
		crowdedBoxes: (count) => `${count} caja(s) conservaron su lugar pero quedaron mas anchas, y ahora aprietan a una vecina (regenera con --relayout para volver a acomodarlas):`,
	},
}

/** Las posiciones del archivo anterior, si es que hay uno. */
const previousGeometryOf = async (options) => {
	if (options.relayout || !options.output || !existsSync(options.output)) return new Map()
	return readGeometry(await readFile(options.output, 'utf8'))
}

runGenerator({
	help: HELP,
	extraOptions: {
		'--relayout': (o) => { o.relayout = true },
	},
	render: async ({ model, config, options, files }) => {
		const say = messagesFor(MESSAGES, options.language)
		const previousGeometry = await previousGeometryOf(options)
		if (previousGeometry.size && !options.quiet) {
			console.log(`   ${say.keptPositions(previousGeometry.size)}`)
		}
		return renderDrawio(model, {
			// El ruteo verifica lo que dibuja. Si alguna flecha no encontro camino
			// limpio conviene enterarse, en vez de descubrirlo al abrir el archivo.
			report: ({ warnings, crowded = [] }) => {
				if (options.quiet) return
				if (crowded.length) {
					console.log(`   ${say.crowdedBoxes(crowded.length)}`)
					for (const name of crowded) console.log(`     - ${name}`)
				}
				if (!warnings.length) return
				console.log(`   ${say.blockedArrows(warnings.length)}`)
				for (const warning of warnings) console.log(`     - ${warning}`)
			},
			// Sin titulo ni archivo de salida, el nombre por defecto lo pone
			// renderDrawio, en el idioma de `language`.
			name: options.title ?? config.title ?? (options.output ? basename(options.output, '.drawio') : undefined),
			language: options.language,
			associations: options.associations,
			showAttributes: options.showAttributes,
			showOperations: options.showOperations,
			showMutability: options.showMutability,
			showFamilies: options.showFamilies,
			palette: options.palette,
			previousGeometry,
			header: provenanceOf('wolloksd2drawio', files, config, options.language),
		})
	},
}).catch((error) => {
	console.error(error.message)
	process.exit(1)
})
