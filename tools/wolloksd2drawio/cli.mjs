#!/usr/bin/env node
/*
 * wolloksd2drawio — genera el diagrama de clases en formato draw.io (diagrams.net)
 * a partir de codigo Wollok.
 *
 *   node tools/wolloksd2drawio/cli.mjs src/ladrones.wlk -o docs/ladrones.drawio
 *
 * A diferencia del PlantUML, el .drawio guarda las posiciones: se abre en
 * draw.io (o en la extension de VSCode) y se arrastra todo a gusto.
 *
 * Al regenerarlo, las cajas que ya estaban CONSERVAN donde las dejaste: los ids
 * son estables (el nombre de la entidad) y se reusa la geometria del archivo
 * anterior. Las cajas nuevas se agregan abajo. Con --relayout se recalcula todo
 * desde cero.
 *
 * Opciones:
 *   -o, --output <archivo>     archivo .drawio de salida (por defecto: stdout)
 *   -c, --config <archivo>     sidecar .uml.json (por defecto: <fuente>.uml.json)
 *   -t, --title <texto>        nombre de la pestaña del diagrama
 *       --relayout             ignorar las posiciones del archivo anterior
 *       --without-inference    no deducir familias polimorficas: ni la interfaz
 *                              que les falta, ni el color compartido
 *       --associations <modo>  both (por defecto) | arrow | attribute
 *       --no-attributes        no mostrar atributos
 *       --no-operations        no mostrar metodos
 *       --no-mutability        no mostrar const/var
 *       --include-tests        incluir .wtest y .wpgm
 *   -q, --quiet                no mostrar advertencias
 *
 * La otra salida posible es PlantUML: ver tools/wollok2puml.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { runGenerator, provenanceOf } from '../wollok-uml/generator.mjs'
import { renderDrawio, readGeometry } from './render.mjs'

/** Las posiciones del archivo anterior, si es que hay uno. */
const previousGeometryOf = async (options) => {
	if (options.relayout || !options.output || !existsSync(options.output)) return new Map()
	return readGeometry(await readFile(options.output, 'utf8'))
}

runGenerator({
	helpFrom: import.meta.url,
	extraOptions: {
		'--relayout': (o) => { o.relayout = true },
	},
	render: async ({ model, config, options, files }) => {
		const previousGeometry = await previousGeometryOf(options)
		if (previousGeometry.size && !options.quiet) {
			console.log(`   (conservo la posicion de ${previousGeometry.size} caja(s) del archivo anterior)`)
		}
		return renderDrawio(model, {
			// El ruteo verifica lo que dibuja. Si alguna flecha no encontro camino
			// limpio conviene enterarse, en vez de descubrirlo al abrir el archivo.
			report: ({ warnings }) => {
				if (!warnings.length || options.quiet) return
				console.log(`   ${warnings.length} flecha(s) sin camino libre (alguna caja tapa el paso):`)
				for (const warning of warnings) console.log(`     - ${warning}`)
			},
			name: options.title ?? config.title ?? (options.output ? basename(options.output, '.drawio') : 'Diagrama de clases'),
			associations: options.associations,
			showAttributes: options.showAttributes,
			showOperations: options.showOperations,
			showMutability: options.showMutability,
			showFamilies: options.showFamilies,
			previousGeometry,
			header: provenanceOf('wolloksd2drawio', files, config),
		})
	},
}).catch((error) => {
	console.error(error.message)
	process.exit(1)
})
