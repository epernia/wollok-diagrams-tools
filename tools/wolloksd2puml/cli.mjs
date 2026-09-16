#!/usr/bin/env node
/*
 * wolloksd2puml — genera el diagrama de clases en PlantUML a partir de codigo Wollok.
 *
 *   node tools/wolloksd2puml/cli.mjs src/ladrones.wlk -o docs/ladrones.puml
 *   node tools/wolloksd2puml/cli.mjs src -o docs/todo.puml --title "Mi dominio" --eslang
 *
 * Las opciones estan en help.mjs (o con --help). La otra salida posible es
 * draw.io: ver tools/wolloksd2drawio.
 */

import { basename } from 'node:path'
import { runGenerator, provenanceOf } from '../wollok-uml/generator.mjs'
import { renderPlantUML } from './render.mjs'
import { HELP } from './help.mjs'

runGenerator({
	help: HELP,
	render: ({ model, config, options, files }) => renderPlantUML(model, {
		// Sin archivo de salida, el nombre por defecto lo pone renderPlantUML, en el
		// idioma de `language`.
		name: options.output ? basename(options.output, '.puml') : undefined,
		language: options.language,
		title: options.title ?? config.title,
		associations: options.associations,
		showAttributes: options.showAttributes,
		showOperations: options.showOperations,
		showMutability: options.showMutability,
		showFamilies: options.showFamilies,
		palette: options.palette,
		...(config.skinparams ? { skinparams: config.skinparams } : {}),
		header: provenanceOf('wolloksd2puml', files, config, options.language),
	}),
}).catch((error) => {
	console.error(error.message)
	process.exit(1)
})
