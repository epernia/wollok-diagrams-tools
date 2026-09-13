/*
 * De que color va cada entidad del diagrama de clases.
 *
 * Vive en el nucleo porque el diagrama de clases tiene DOS salidas —draw.io y
 * PlantUML— y las dos tienen que pintar igual. Antes cada una lo resolvia por su
 * cuenta, o no lo resolvia: PlantUML no tenia colores, y ni siquiera entendia
 * los flags de paleta.
 *
 * Devuelve un color para TODAS las entidades, sin huecos. Eso importa: el
 * respaldo por tipo (el color de una clase o de un WKO que no se llevo ninguno de
 * familia) estaba en draw.io como una tabla que, al separarse por paleta, quedo
 * adentro de una funcion y afuera del alcance de la que dibuja las cajas. Nunca
 * se notaba, porque con familias todas las cajas tienen color y la tabla no se
 * mira. Con --without-inference no hay familias, se la buscaba y el generador se
 * caia con "PALETTE is not defined". Resolviendolo aca, completo, el que dibuja
 * solo tiene que leer.
 */

import { colorIndexOf } from './families.mjs'
import { styleFor } from './palette.mjs'

/*
 * El color de respaldo, por tipo de entidad, para la que no se llevo ninguno de
 * familia: porque no es polimorfica con nadie y se pidio --without-inference, o
 * porque es una interfaz que nadie implementa.
 *
 * Con wollok light mode no hace falta tabla: en el diagrama de clases TODAS las
 * entidades son tuyas —se sacan leyendo tu .wlk, la biblioteca no se dibuja— asi
 * que van todas del azul del usuario.
 *
 * Los tonos de la accesible salen de la paleta del nucleo, la misma de la que
 * salen los de familia. Medidos con daltonismo simulado, estos cuatro quedan en
 * un peor par de ΔE 7.9 contra el 3.9 de los pastel, que era casi nada.
 */
const BY_KIND_ACCESSIBLE = {
	class: { fill: '#FFFFFF', stroke: '#34495E' },
	wko: { fill: '#EBB233', stroke: '#A16F00' },
	interface: { fill: '#338EC1', stroke: '#00507D' },
	mixin: { fill: '#D694B9', stroke: '#8F5575' },
}

const BY_KIND_PASTEL = {
	class: { fill: '#FFFFFF', stroke: '#34495E' },
	// el mismo naranja que el spot << (O,#FF7700) WKO >> del PlantUML
	wko: { fill: '#FFE6CC', stroke: '#D79B00' },
	interface: { fill: '#DAE8FC', stroke: '#6C8EBF' },
	mixin: { fill: '#E1D5E7', stroke: '#9673A6' },
}

const kindColorOf = (kind, palette) => {
	if (palette === 'wollok') return styleFor({ library: false }, { palette })
	const table = palette === 'pastel' ? BY_KIND_PASTEL : BY_KIND_ACCESSIBLE
	return table[kind] ?? table.class
}

/**
 * MISMO COLOR = MISMA FAMILIA POLIMORFICA (en las paletas por familia).
 *
 * El reparto lo decide families.mjs, no este archivo, y por eso el diagrama de
 * objetos elige exactamente los mismos colores: los dos preguntan lo mismo al
 * mismo lugar.
 */
const familyColorsOf = (model, palette) => {
	const colors = new Map()
	// en el diagrama de clases no hay entidades de la biblioteca: todas son del
	// usuario, y para wollok light mode el indice de familia no se mira
	for (const [name, index] of colorIndexOf(model)) colors.set(name, styleFor({ index, library: false }, { palette }))

	// La caja de una interfaz va del color de quienes la implementan: es la
	// cabeza de esa familia, no una cosa aparte. Vale igual para las que
	// declaraste vos y para las que dedujo la herramienta.
	for (const entity of model.interfaces) {
		const implementor = model.entities.find((candidate) => candidate.interfaces.includes(entity.name))
		const color = implementor && colors.get(implementor.name)
		if (color) colors.set(entity.name, color)
	}
	return colors
}

/**
 * @param options.palette       uno de PALETTE_NAMES de palette.mjs
 * @param options.showFamilies  false con --without-inference: sin color por familia
 * @returns Map(nombre de entidad -> { fill, stroke }), con TODAS las entidades
 *          y las interfaces del modelo
 */
export const entityColorsOf = (model, { palette = 'wollok', showFamilies = true } = {}) => {
	const colors = showFamilies ? familyColorsOf(model, palette) : new Map()
	for (const entity of [...model.interfaces, ...model.entities]) {
		if (!colors.has(entity.name)) colors.set(entity.name, kindColorOf(entity.kind, palette))
	}
	return colors
}
