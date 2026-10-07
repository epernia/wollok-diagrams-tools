/*
 * Lo que dice cada flecha del diagrama de clases, escrito sobre la flecha misma:
 *
 *   flecha                                   castellano      ingles
 *   herencia                   ──▷           <hereda>        <inherits>
 *   realizacion de interfaz    - -▷          <implementa>    <implements>
 *   asociacion, agregacion,    ──>  ◇──>     <conoce>        <knows>
 *   composicion                ◆──>
 *   dependencia                - ->          <usa>           <uses>
 *
 * La forma de la flecha ya lo dice en UML, pero hay que saber leerla: con la
 * palabra escrita no hace falta. Va en el idioma de los mensajes (--enlang por
 * defecto, cualquiera de los --es... en castellano), como todo lo que la
 * herramienta escribe por su cuenta.
 *
 * La flecha de un mixin no lleva: no se pidio una palabra para ella, y ninguna de
 * estas le queda bien.
 */

import { messagesFor } from './i18n.mjs'

const LABELS = {
	en: {
		inheritance: '<inherits>',
		realization: '<implements>',
		association: '<knows>',
		aggregation: '<knows>',
		composition: '<knows>',
		dependency: '<uses>',
	},
	es: {
		inheritance: '<hereda>',
		realization: '<implementa>',
		association: '<conoce>',
		aggregation: '<conoce>',
		composition: '<conoce>',
		dependency: '<usa>',
	},
}

/** El rotulo de una flecha segun su `kind`, o undefined si no lleva. */
export const relationLabelOf = (kind, language) => messagesFor(LABELS, language)[kind]

/**
 * Si un texto es uno de estos rotulos, en cualquiera de los dos idiomas. Lo usa
 * drawio2wollok para no confundirlo con una multiplicidad al leer el diagrama.
 */
export const isRelationLabel = (text) =>
	Object.values(LABELS).some((labels) => Object.values(labels).includes(String(text ?? '').trim()))
