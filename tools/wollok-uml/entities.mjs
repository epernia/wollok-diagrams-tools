/* Las entidades (clases, objetos, mixins) de un entorno, con el archivo donde estan. */

const ENTITY_KINDS = ['Class', 'Singleton', 'Mixin']

const isUserPackage = (pkg) => !['wollok', 'REPL'].includes(pkg.name)

/**
 * Todos los `new Clase(...)` del codigo del usuario, con la entidad donde estan
 * escritos (si estan adentro de una; un `const juliana = new Persona(...)` suelto
 * en el archivo no tiene ninguna).
 *
 * @returns [{ node, owner }]
 */
export const instantiationsOf = (environment) => {
	const found = []
	const seen = new Set()
	const collect = (root, owner) => {
		for (const node of root.descendants ?? []) {
			if (node.kind !== 'New' || seen.has(node)) continue
			seen.add(node)
			found.push({ node, owner })
		}
	}
	// Se baja desde cada entidad y no se sube desde el `new` buscando quien lo
	// contiene: `parent` es una propiedad perezosa de wollok-ts que no siempre
	// esta inicializada, y leerla revienta. Lo que queda despues, en el paquete,
	// son los `new` sueltos del archivo, que no tienen dueno.
	for (const { node } of entityNodesOf(environment)) collect(node, node)
	for (const pkg of environment.members.filter(isUserPackage)) collect(pkg, undefined)
	return found
}

/** @returns [{ node, fileName }] en el orden en que aparecen en el codigo. */
export const entityNodesOf = (environment) => {
	const found = []
	const visit = (pkg, fileName) => {
		for (const member of pkg.members) {
			if (member.kind === 'Package') visit(member, member.fileName ?? fileName)
			// las entidades anonimas (closures, object literals) no van al diagrama
			else if (ENTITY_KINDS.includes(member.kind) && member.name) found.push({ node: member, fileName })
		}
	}
	for (const pkg of environment.members.filter(isUserPackage)) visit(pkg, pkg.fileName)
	return found
}
