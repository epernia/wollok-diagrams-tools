/* Las entidades (clases, objetos, mixins) de un entorno, con el archivo donde estan. */

const ENTITY_KINDS = ['Class', 'Singleton', 'Mixin']

const isUserPackage = (pkg) => !['wollok', 'REPL'].includes(pkg.name)

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
