#!/usr/bin/env node
/*
 * wolloksd2puml — genera el diagrama de clases en PlantUML a partir de codigo Wollok.
 *
 *   node tools/wolloksd2puml/cli.mjs src/ladrones.wlk -o docs/ladrones.puml
 *   node tools/wolloksd2puml/cli.mjs src -o docs/todo.puml --title "Mi dominio"
 *
 * Opciones:
 *   -o, --output <archivo>     archivo .puml de salida (por defecto: stdout)
 *   -c, --config <archivo>     sidecar .uml.json (por defecto: <fuente>.uml.json)
 *   -t, --title <texto>        titulo del diagrama
 *       --associations <modo>  both (por defecto) | arrow | attribute
 *       --no-attributes        no mostrar atributos
 *       --no-operations        no mostrar metodos
 *       --no-mutability        no mostrar const/var
 *       --without-inference    no deducir la interfaz que le falta a cada
 *                              familia polimorfica, ni el color compartido
 *       --colourblind          colorear por familia polimorfica, con tonos aptos
 *                              para daltonicos
 *       --pastelcolors         idem, con la paleta pastel de draw.io
 *                              (sin ninguno de los dos: wollok light mode, y como
 *                              aca todas las entidades son tuyas, todas azules)
 *       --include-tests        incluir .wtest y .wpgm
 *   -q, --quiet                no mostrar advertencias
 *
 * La otra salida posible es draw.io: ver tools/wolloksd2drawio.
 */

import { basename } from 'node:path'
import { runGenerator, provenanceOf } from '../wollok-uml/generator.mjs'
import { renderPlantUML } from './render.mjs'

runGenerator({
	helpFrom: import.meta.url,
	render: ({ model, config, options, files }) => renderPlantUML(model, {
		name: options.output ? basename(options.output, '.puml') : 'diagrama-de-clases',
		title: options.title ?? config.title,
		associations: options.associations,
		showAttributes: options.showAttributes,
		showOperations: options.showOperations,
		showMutability: options.showMutability,
		showFamilies: options.showFamilies,
		palette: options.palette,
		...(config.skinparams ? { skinparams: config.skinparams } : {}),
		header: provenanceOf('wolloksd2puml', files, config),
	}),
}).catch((error) => {
	console.error(error.message)
	process.exit(1)
})
