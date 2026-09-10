/*
 * Lectura de las anotaciones @Uml... del codigo Wollok.
 *
 * Wollok tiene sintaxis nativa de anotaciones:
 *
 *     @UmlImplements(interface = "MedidaDeSeguridad")
 *     class Cadena { ... }
 *
 * y wollok-ts las deja en `node.metadata` ya parseadas (nombre + argumentos).
 * No hay que parsear comentarios a mano, y el codigo sigue compilando y
 * corriendo igual: para el interprete son metadatos, no sentencias.
 *
 * Los comentarios TAMBIEN llegan en `node.metadata`, con nombre "comment",
 * asi que si algun dia se quisiera soportar la variante en comentarios, el
 * lugar es este y nada mas que este.
 */

/** Todas las anotaciones de un nodo, sin los comentarios. */
export const annotationsOf = (node) =>
	(node.metadata ?? []).filter((a) => a.name !== 'comment')

/** Los comentarios de un nodo, como texto. */
export const commentsOf = (node) =>
	(node.metadata ?? []).filter((a) => a.name === 'comment').map((a) => a.args.text)

/** La primera anotacion con ese nombre, o undefined. */
export const annotation = (node, name) =>
	annotationsOf(node).find((a) => a.name === name)

/** Todas las anotaciones con ese nombre (para las que pueden repetirse). */
export const allAnnotations = (node, name) =>
	annotationsOf(node).filter((a) => a.name === name)

/** El valor de un argumento de una anotacion, o undefined. */
export const arg = (node, name, argName) => annotation(node, name)?.args?.[argName]

export const isHidden = (node) => !!annotation(node, 'UmlHide')

/** Nombres de anotacion que entiende el generador (para avisar de typos). */
export const KNOWN_ANNOTATIONS = [
	'UmlType',
	'UmlReturns',
	'UmlImplements',
	'UmlRelation',
	'UmlNote',
	'UmlStereotype',
	'UmlHide',
]

/** Anotaciones @Uml... escritas en el codigo que el generador no conoce. */
export const unknownUmlAnnotations = (node) =>
	annotationsOf(node)
		.filter((a) => a.name.startsWith('Uml') && !KNOWN_ANNOTATIONS.includes(a.name))
		.map((a) => a.name)
