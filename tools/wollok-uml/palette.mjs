/*
 * La paleta de colores de los diagramas.
 *
 * Vive en el nucleo porque la usan los DOS: el de clases y el de objetos. Y no
 * es decoracion — es la forma de que los dos digan lo mismo: una cosa sale del
 * mismo color en los dos diagramas, asi se pueden mirar juntos.
 *
 * Lo que el color SIGNIFICA depende de la paleta, y es lo primero que hay que
 * tener claro al leer este archivo.
 *
 * Hay TRES paletas, y no todas contestan la misma pregunta:
 *
 *   wollok light mode  (por defecto)  el color dice DE DONDE VIENE la cosa:
 *                                     verde lo que trae Wollok, azul lo que
 *                                     escribiste vos. Dos colores, y nada mas.
 *   --colourblind                     el color dice la FAMILIA POLIMORFICA, con
 *                                     tonos elegidos para vision dicromata
 *   --pastelcolors                    idem, con la paleta pastel de draw.io
 *
 * O sea que la de por defecto cambia lo que el color SIGNIFICA: con wollok light
 * mode las familias polimorficas dejan de verse por color (se siguen calculando,
 * y se siguen usando para deducir interfaces y para el reporte). Es un cambio a
 * proposito: separar biblioteca de codigo propio es lo primero que uno necesita
 * ver cuando esta aprendiendo, y para eso alcanzan dos colores.
 *
 * En las dos paletas por familia la regla es:
 *
 *   MISMO COLOR = MISMA FAMILIA POLIMORFICA.
 *
 * Quien no es polimorfico con nadie tambien recibe su propio color, distinto al
 * de todos los demas. Antes todos los WKO solitarios compartian el naranja, y
 * eso decia justo lo contrario de lo que el color tiene que decir: los ponia
 * juntos sin tener nada que ver entre si.
 *
 * El indice lo reparte families.mjs (colorIndexOf): primero los grupos y
 * despues los individuales, para que los grupos —que es lo que importa ver de un
 * vistazo— se lleven los colores mas distinguibles.
 */

/*
 * LA PALETA POR DEFECTO: WOLLOK LIGHT MODE
 *
 * Dos colores y una sola pregunta: esto lo trae Wollok, o lo escribiste vos.
 *
 * El verde es para la biblioteca —los numeros, los strings, los booleanos, las
 * List y los Set, las Date— y el azul para las clases y los objetos propios. Se
 * reconoce por el nombre completo del modulo: todo lo que empieza con `wollok.`
 * viene de la biblioteca.
 *
 * Es la unica de las tres que NO habla de familias polimorficas. Con dos colores
 * no hay como: lo que gana en cambio es que de un vistazo se ve que parte del
 * dibujo es tu modelo y que parte es andamio del lenguaje.
 */
const WOLLOK_LIGHT = {
	library: { fill: '#6FDC4B', stroke: '#26A324' },
	user: { fill: '#7CC0D8', stroke: '#248AC8' },
}

/*
 * LA PALETA APTA PARA DALTONICOS (--colourblind)
 *
 * Siete tonos de Okabe-Ito —el conjunto categorico que se usa como referencia
 * para vision con deficiencia de color— en dos escalones de claridad, uno al 20%
 * hacia el blanco y otro al 70%. El texto negro de adentro de la caja se lee en
 * todos: el peor queda en 5.8:1, arriba del 4.5:1 que pide WCAG AA.
 *
 * Los dos escalones no son un relleno para llegar a catorce. La vision dicromata
 * pierde TONOS pero no pierde CLARIDAD, asi que dos colores que un daltonico ve
 * del mismo tono se siguen distinguiendo si uno es mas claro que el otro. Un
 * segundo escalon de claridad compra mas colores utiles que seguir buscando
 * tonos nuevos, que es lo que hacia la cola vieja.
 *
 * EL ORDEN NO ES DECORATIVO Y NO SE TOCA. En un diagrama se ven todas las cajas
 * al mismo tiempo, asi que lo que importa no es que dos vecinos de esta lista se
 * distingan entre si: es que se distinga el PEOR de todos los pares que entren
 * en juego. Y ese peor par empeora siempre que entra un color mas. Asi que el
 * orden se eligio calculado, por punto mas lejano: primero el par mas separado
 * de todos y despues, cada vez, el color cuya distancia minima a los ya elegidos
 * sea la mayor. De ahi que los escalones vengan intercalados y no uno despues
 * del otro: intercalados, las colisiones caen bastante mas tarde.
 *
 * Medido con proteranopia y deuteranopia simuladas (matrices de Machado),
 * distancia en OKLab x100 sobre TODOS los pares. La referencia pide 8 y tolera 6
 * cuando hay una segunda pista ademas del color:
 *
 *   colores en juego      3      5      7      9     11
 *   esta paleta        20.0   11.6    9.3    6.8    6.1
 *   la pastel           8.1    6.2    1.1    1.1    0.3
 *
 * O sea que esta aguanta el objetivo hasta siete y el piso hasta once, y la
 * pastel se cae en cuanto hay mas de cinco: con siete ya esta en 1.1, que es no
 * distinguirse. Once alcanza para todos los ejemplos del repo — el mas cargado
 * es el diagrama de clases de ej3SueldoDePepe, con once entidades.
 *
 * Pasado ese punto ninguna paleta de rellenos claros alcanza: son demasiados
 * colores para el espacio que deja la vision dicromata. Lo que salva al diagrama
 * es que el color NUNCA es la unica pista — cada caja y cada ovalo llevan su
 * nombre escrito adentro. El color agrupa de un vistazo; el nombre identifica.
 */
const ACCESSIBLE = [
	{ fill: '#338EC1', stroke: '#00507D' },   // azul
	{ fill: '#F3E968', stroke: '#A8A02E' },   // amarillo
	{ fill: '#DD7E33', stroke: '#954200' },   // bermellon
	{ fill: '#B3D5E8', stroke: '#00507D' },   // azul claro
	{ fill: '#33B18F', stroke: '#006F51' },   // verde
	{ fill: '#EBB233', stroke: '#A16F00' },   // naranja
	{ fill: '#FBF7C6', stroke: '#A8A02E' },   // amarillo claro
	{ fill: '#F2CFB3', stroke: '#954200' },   // bermellon claro
	{ fill: '#D694B9', stroke: '#8F5575' },   // rosa
	{ fill: '#78C3ED', stroke: '#3C7EA3' },   // celeste
	{ fill: '#CCE9F8', stroke: '#3C7EA3' },   // celeste claro
	{ fill: '#B3E2D5', stroke: '#006F51' },   // verde claro
	{ fill: '#F8E2B3', stroke: '#A16F00' },   // naranja claro
	{ fill: '#F0D7E5', stroke: '#8F5575' },   // rosa claro
]

/*
 * LA PALETA PASTEL (--pastelcolors)
 *
 * Los colores de la paleta de draw.io: claros, con buen contraste contra texto
 * negro, y con su borde mas oscuro del mismo tono. Se ven mas suaves y para dos
 * o tres familias andan bien. Quedan para el que prefiera este aspecto, o para
 * comparar con un diagrama viejo.
 */
const PASTEL = [
	{ fill: '#DAE8FC', stroke: '#6C8EBF' },   // azul
	{ fill: '#CC99FF', stroke: '#9673A6' },   // violeta
	{ fill: '#CCFFCC', stroke: '#82B366' },   // verde claro
	{ fill: '#FFFF99', stroke: '#D6B656' },   // amarillo
	{ fill: '#F8CECC', stroke: '#B85450' },   // rosa
	{ fill: '#B1DDF0', stroke: '#10739E' },   // celeste
	{ fill: '#FFE6CC', stroke: '#D79B00' },   // durazno
	{ fill: '#E1D5E7', stroke: '#9673A6' },   // lila
	{ fill: '#D0CEE2', stroke: '#56517E' },   // gris violaceo
	{ fill: '#FAD9D5', stroke: '#AE4132' },   // salmon
	{ fill: '#D5E8D4', stroke: '#82B366' },   // verde grisaceo
	{ fill: '#FFF2CC', stroke: '#D6B656' },   // crema
]

const hsl = (hue, saturation, lightness) => {
	const a = saturation * Math.min(lightness, 1 - lightness)
	const channel = (n) => {
		const k = (n + hue / 30) % 12
		const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
		return Math.round(255 * value).toString(16).padStart(2, '0')
	}
	return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase()
}

/*
 * Pasados los elegidos a mano se generan solos, rotando el tono con el angulo
 * aureo (137.5 grados) para que dos consecutivos nunca queden parecidos. Salen
 * igual de claros que los de arriba, asi el texto negro se sigue leyendo.
 *
 * Ojo: dos tonos distintos pueden ser el MISMO color para un daltonico, asi que
 * de aca en adelante ninguna paleta promete que se distingan. Es el precio de
 * ser una funcion total, y llegar hasta aca quiere decir que el diagrama tiene
 * mas de doce o catorce grupos: a esa altura conviene partirlo antes que pedirle
 * mas al color.
 */
const generatedPastel = (index) => {
	const hue = (index * 137.508) % 360
	return { fill: hsl(hue, 0.55, 0.88), stroke: hsl(hue, 0.45, 0.45) }
}

/*
 * La cola de la paleta apta para daltonicos hace lo mismo con el tono, pero
 * ademas va cambiando la CLARIDAD en tres escalones, por el mismo motivo que la
 * paleta de arriba tiene dos: es lo unico que le queda para diferenciar cuando
 * el tono ya no alcanza.
 */
const LIGHTNESS_STEPS = [0.78, 0.62, 0.88]

const generatedAccessible = (index) => {
	const hue = (index * 137.508) % 360
	const lightness = LIGHTNESS_STEPS[index % LIGHTNESS_STEPS.length]
	return { fill: hsl(hue, 0.62, lightness), stroke: hsl(hue, 0.70, lightness - 0.40) }
}

/**
 * El color numero n de una paleta por familia. Es una funcion total: nunca se
 * queda sin colores.
 */
const colorAt = (index, pastel) => {
	const picked = pastel ? PASTEL : ACCESSIBLE
	if (index < picked.length) return picked[index]
	const rest = index - picked.length
	return pastel ? generatedPastel(rest) : generatedAccessible(rest)
}

/** Los nombres validos; el primero es el de por defecto. */
export const PALETTE_NAMES = ['wollok', 'colourblind', 'pastel']

/**
 * El relleno y el borde de una caja o de un ovalo.
 *
 * Las tres paletas se piden igual y cada una decide que parte del sujeto le
 * importa: wollok light mode mira de donde viene, las otras dos que familia es.
 * Asi el que dibuja no tiene que saber cual esta activa.
 *
 * @param subject.index    indice de color de su familia, de colorIndexOf
 * @param subject.library  si la cosa viene con Wollok
 * @param options.palette  uno de PALETTE_NAMES
 */
export const styleFor = ({ index = 0, library = false }, { palette = 'wollok' } = {}) => {
	if (palette === 'wollok') return WOLLOK_LIGHT[library ? 'library' : 'user']
	return colorAt(index, palette === 'pastel')
}

/** Si el modulo de una cosa dice que viene de la biblioteca de Wollok. */
export const isFromLibrary = (module) => String(module ?? '').startsWith('wollok.')
