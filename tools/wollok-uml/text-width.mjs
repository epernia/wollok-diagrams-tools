/*
 * Cuanto ocupa un texto en draw.io, en pixeles.
 *
 * draw.io escribe las cajas en Helvetica de 12px, que en Windows es Arial (y en
 * Linux, Liberation Sans): las tres tienen los mismos anchos de letra. Los numeros
 * de abajo son el ancho de cada caracter medido en el navegador, que es lo que usa
 * draw.io para dibujar (tambien la extension de VSCode). Sumarlos da el ancho de un
 * renglon con un error de alrededor de 1px contra el texto real: en las filas casi
 * siempre para arriba, pero en el nombre (black) el kerning de Arial Black puede
 * dejarlo 1 o 2px corto, que lo cubre el margen del encabezado (ver layout.mjs).
 *
 * Tres pesos, porque el encabezado de una caja usa dos:
 *   - regular: las filas. La italica de los tipos mide exactamente lo mismo.
 *   - bold:    el renglon del estereotipo («class»), porque la caja es fontStyle=1.
 *   - black:   el nombre. Va en <b> adentro de una caja que ya es negrita, y el
 *              navegador lo lleva a peso 900: en Windows eso es Arial Black, bastante
 *              mas ancha. Medirlo como bold dejaba nombres saliendose de la caja.
 *
 * Lo que no esta en la tabla:
 *   - un emoji mide EMOJI_WIDTH (16.5px en Chromium, con cualquier peso);
 *   - las marcas que se pegan a la letra anterior (una tilde combinante, el selector
 *     de variante U+FE0F, el unidor U+200D) no ocupan lugar propio;
 *   - cualquier otro caracter, una letra de otro alfabeto, cuenta UNKNOWN_WIDTH, un
 *     poco mas que la mas ancha que se midio (la Щ en black, 13.7px): mejor que
 *     sobre a que el texto no entre.
 */

const WIDTHS = {
	regular: {
		// 32 (espacio) a 126 (~)
		ascii: [
			3.33, 3.33, 4.26, 6.67, 6.67, 10.67, 8, 2.29, 4, 4, 4.67, 7.01,
			3.33, 4, 3.33, 3.33, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67,
			6.67, 6.67, 3.33, 3.33, 7.01, 7.01, 7.01, 6.67, 12.18, 8, 8, 8.67,
			8.67, 8, 7.33, 9.33, 8.67, 3.33, 6, 8, 6.67, 10, 8.67, 9.33,
			8, 9.33, 8.67, 8, 7.33, 8.67, 8, 11.33, 8, 8, 7.33, 3.33,
			3.33, 3.33, 5.63, 6.67, 4, 6.67, 6.67, 6, 6.67, 6.67, 3.33, 6.67,
			6.67, 2.67, 2.67, 6, 2.67, 10, 6.67, 6.67, 6.67, 6.67, 4, 6,
			3.33, 6.67, 6, 8.67, 6, 6, 6, 4.01, 3.12, 4.01, 7.01,
		],
		// 160 (espacio duro) a 255 (ÿ): tildes, ñ, «»
		latin: [
			3.33, 4, 6.67, 6.67, 6.67, 6.67, 3.12, 6.67, 4, 8.84, 4.44, 6.67,
			7.01, 0, 8.84, 6.63, 4.8, 6.59, 4, 4, 4, 6.91, 6.45, 4,
			4, 4, 4.38, 6.67, 10.01, 10.01, 10.01, 7.33, 8, 8, 8, 8,
			8, 8, 12, 8.67, 8, 8, 8, 8, 3.33, 3.33, 3.33, 3.33,
			8.67, 8.67, 9.33, 9.33, 9.33, 9.33, 9.33, 7.01, 9.33, 8.67, 8.67, 8.67,
			8.67, 8, 8, 7.33, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 10.67, 6,
			6.67, 6.67, 6.67, 6.67, 3.33, 3.33, 3.33, 3.33, 6.67, 6.67, 6.67, 6.67,
			6.67, 6.67, 6.67, 6.59, 7.33, 6.67, 6.67, 6.67, 6.67, 6, 6.67, 6,
		],
		extra: { '—': 12, '–': 6.67, '’': 2.67, '‘': 2.67, '“': 4, '”': 4, '…': 12, '•': 4.2, '€': 6.67 },
	},
	bold: {
		// 32 (espacio) a 126 (~)
		ascii: [
			3.33, 4, 5.69, 6.67, 6.67, 10.67, 8.67, 2.85, 4, 4, 4.67, 7.01,
			3.33, 4, 3.33, 3.33, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67,
			6.67, 6.67, 4, 4, 7.01, 7.01, 7.01, 7.33, 11.7, 8.67, 8.67, 8.67,
			8.67, 8, 7.33, 9.33, 8.67, 3.33, 6.67, 8.67, 7.33, 10, 8.67, 9.33,
			8, 9.33, 8.67, 8, 7.33, 8.67, 8, 11.33, 8, 8, 7.33, 4,
			3.33, 4, 7.01, 6.67, 4, 6.67, 7.33, 6.67, 7.33, 6.67, 4, 7.33,
			7.33, 3.33, 3.33, 6.67, 3.33, 10.67, 7.33, 7.33, 7.33, 7.33, 4.67, 6.67,
			4, 7.33, 6.67, 9.33, 6.67, 6.67, 6, 4.67, 3.36, 4.67, 7.01,
		],
		// 160 (espacio duro) a 255 (ÿ): tildes, ñ, «»
		latin: [
			3.33, 4, 6.67, 6.67, 6.67, 6.67, 3.36, 6.67, 4, 8.84, 4.44, 6.67,
			7.01, 0, 8.84, 6.63, 4.8, 6.59, 4, 4, 4, 6.91, 6.67, 4,
			4, 4, 4.38, 6.67, 10.01, 10.01, 10.01, 7.33, 8.67, 8.67, 8.67, 8.67,
			8.67, 8.67, 12, 8.67, 8, 8, 8, 8, 3.33, 3.33, 3.33, 3.33,
			8.67, 8.67, 9.33, 9.33, 9.33, 9.33, 9.33, 7.01, 9.33, 8.67, 8.67, 8.67,
			8.67, 8, 8, 7.33, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 10.67, 6.67,
			6.67, 6.67, 6.67, 6.67, 3.33, 3.33, 3.33, 3.33, 7.33, 7.33, 7.33, 7.33,
			7.33, 7.33, 7.33, 6.59, 7.33, 7.33, 7.33, 7.33, 7.33, 6.67, 7.33, 6.67,
		],
		extra: { '—': 12, '–': 6.67, '’': 3.33, '‘': 3.33, '“': 6, '”': 6, '…': 12, '•': 4.2, '€': 6.67 },
	},
	black: {
		// 32 (espacio) a 126 (~)
		ascii: [
			4, 4, 6, 7.92, 8, 12, 10.67, 3.33, 4.67, 4.67, 6.67, 7.92,
			4, 4, 4, 3.33, 8, 8, 8, 8, 8, 8, 8, 8,
			8, 8, 4, 4, 7.92, 7.92, 7.92, 7.33, 8.88, 9.33, 9.33, 9.33,
			9.33, 8.67, 8, 10, 10, 4.67, 8, 10, 8, 11.33, 10, 10,
			8.67, 10, 9.33, 8.67, 8.67, 10, 9.33, 12, 9.33, 9.33, 8.67, 4.67,
			3.33, 4.67, 7.92, 6, 4, 8, 8, 8, 8, 8, 4.67, 8,
			8, 4, 4, 8, 4, 12, 8, 8, 8, 8, 5.33, 7.33,
			5.33, 8, 7.33, 11.33, 8, 7.33, 6.67, 4.67, 3.33, 4.67, 7.92,
		],
		// 160 (espacio duro) a 255 (ÿ): tildes, ñ, «»
		latin: [
			4, 4, 8, 8, 7.92, 8, 3.33, 8, 4, 9.6, 4.8, 8,
			7.92, 0, 9.6, 6, 4.8, 7.92, 4.8, 4.8, 4, 8, 10.2, 4,
			4, 4.8, 4.8, 8, 12, 12, 12, 7.33, 9.33, 9.33, 9.33, 9.33,
			9.33, 9.33, 12, 9.33, 8.67, 8.67, 8.67, 8.67, 4.67, 4.67, 4.67, 4.67,
			9.33, 10, 10, 10, 10, 10, 10, 7.92, 10, 10, 10, 10,
			10, 9.33, 8.67, 8, 8, 8, 8, 8, 8, 8, 12, 8,
			8, 8, 8, 8, 4, 4, 4, 4, 8, 8, 8, 8,
			8, 8, 8, 7.92, 8, 8, 8, 8, 8, 7.33, 8, 7.33,
		],
		extra: { '—': 12, '–': 6, '’': 3.33, '‘': 3.33, '“': 6, '”': 6, '…': 12, '•': 6, '€': 8 },
	},
}

const EMOJI_WIDTH = 16.5
const UNKNOWN_WIDTH = 14

const widthOfCharacter = (character, table) => {
	const code = character.codePointAt(0)
	if (code >= 32 && code <= 126) return table.ascii[code - 32]
	if (code >= 160 && code <= 255) return table.latin[code - 160]
	if (table.extra[character] !== undefined) return table.extra[character]
	if (/\p{M}|\u200D/u.test(character)) return 0
	if (/\p{Extended_Pictographic}/u.test(character)) return EMOJI_WIDTH
	return UNKNOWN_WIDTH
}

/**
 * El ancho de un renglon de texto plano (sin HTML).
 * @param options.weight  'regular' (por defecto), 'bold' o 'black'
 */
export const textWidthOf = (text, { weight = 'regular' } = {}) => {
	const table = WIDTHS[weight] ?? WIDTHS.regular
	let width = 0
	for (const character of String(text ?? '')) width += widthOfCharacter(character, table)
	return width
}
