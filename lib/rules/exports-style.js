/**
 * @author Toru Nagashima
 * See LICENSE file in root directory for full license.
 */
"use strict"

const { hasParentNode } = require("../util/has-parent-node.js")
const { getSourceCode, getScope } = require("../util/eslint-compat")

/*istanbul ignore next */
/**
 * This function is copied from https://github.com/eslint/eslint/blob/2355f8d0de1d6732605420d15ddd4f1eee3c37b6/lib/ast-utils.js#L648-L684
 *
 * @param {import('estree').Node} node - The node to get.
 * @returns {string | null | undefined} The property name if static. Otherwise, null.
 * @private
 */
function getStaticPropertyName(node) {
    /** @type {import('estree').Expression | import('estree').PrivateIdentifier | null} */
    let prop = null

    switch (node?.type) {
        case "Property":
        case "MethodDefinition":
            prop = node.key
            break

        case "MemberExpression":
            prop = node.property
            break

        // no default
    }

    switch (prop?.type) {
        case "Literal":
            return String(prop.value)

        case "TemplateLiteral":
            if (prop.expressions.length === 0 && prop.quasis.length === 1) {
                return prop.quasis[0]?.value.cooked
            }
            break

        case "Identifier":
            if (node.type === "MemberExpression" && node.computed === false) {
                return prop.name
            }
            break

        // no default
    }

    return null
}

/**
 * Checks whether the given node is assignee or not.
 *
 * @param {import('estree').Node} node - The node to check.
 * @returns {boolean} `true` if the node is assignee.
 */
function isAssignee(node) {
    return (
        hasParentNode(node) &&
        node.parent?.type === "AssignmentExpression" &&
        node.parent.left === node
    )
}

/**
 * Gets the top assignment expression node if the given node is an assignee.
 *
 * This is used to distinguish 2 assignees belong to the same assignment.
 * If the node is not an assignee, this returns null.
 *
 * @param {import('estree').Node} leafNode - The node to get.
 * @returns {import('estree').Node | null} The top assignment expression node, or null.
 */
function getTopAssignment(leafNode) {
    let node = leafNode

    // Skip MemberExpressions.
    while (
        hasParentNode(node) &&
        node.parent.type === "MemberExpression" &&
        node.parent.object === node
    ) {
        node = node.parent
    }

    // Check assignments.
    if (!isAssignee(node)) {
        return null
    }

    // Find the top.
    while (hasParentNode(node) && node.parent.type === "AssignmentExpression") {
        node = node.parent
    }

    return node
}

/**
 * Gets top assignment nodes of the given node list.
 *
 * @param {import('estree').Node[]} nodes - The node list to get.
 * @returns {import('estree').Node[]} Gotten top assignment nodes.
 */
function createAssignmentList(nodes) {
    return nodes.map(getTopAssignment).filter(input => input != null)
}

/**
 * Gets the reference of `module.exports` from the given scope.
 *
 * @param {import('eslint').Scope.Scope} scope - The scope to get.
 * @returns {import('estree').Node[]} Gotten MemberExpression node list.
 */
function getModuleExportsNodes(scope) {
    const variable = scope.set.get("module")
    if (variable == null) {
        return []
    }

    /** @type {import('estree').Node[]} */
    const nodes = []

    for (const reference of variable.references) {
        if (hasParentNode(reference.identifier) === false) {
            continue
        }
        const node = reference.identifier.parent
        if (
            node.type === "MemberExpression" &&
            getStaticPropertyName(node) === "exports"
        ) {
            nodes.push(node)
        }
    }
    return nodes
}

/**
 * Gets the reference of `exports` from the given scope.
 *
 * @param {import('eslint').Scope.Scope} scope - The scope to get.
 * @returns {import('estree').Identifier[]} Gotten Identifier node list.
 */
function getExportsNodes(scope) {
    const variable = scope.set.get("exports")
    if (variable == null) {
        return []
    }

    return variable.references.map(reference => reference.identifier)
}

/**
 * @param {import('estree').Node} property
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {string | null}
 */
function getReplacementForProperty(property, sourceCode) {
    if (property.type !== "Property" || property.kind !== "init") {
        // We don't have a nice syntax for adding these directly on the exports object. Give up on fixing the whole thing:
        // property.kind === 'get':
        //   module.exports = { get foo() { ... } }
        // property.kind === 'set':
        //   module.exports = { set foo() { ... } }
        // property.type === 'SpreadElement':
        //   module.exports = { ...foo }
        return null
    }

    let fixedValue = sourceCode.getText(property.value)
    if (property.value.type === "FunctionExpression" && property.method) {
        fixedValue = `function${
            property.value.generator ? "*" : ""
        } ${fixedValue}`
        if (property.value.async) {
            fixedValue = `async ${fixedValue}`
        }
    }
    const lines = sourceCode
        .getCommentsBefore(property)
        // @ts-expect-error getText supports both BaseNode and BaseNodeWithoutComments
        .map(comment => sourceCode.getText(comment))
    if (property.key.type === "Literal" || property.computed) {
        // String or dynamic key:
        // module.exports = { [ ... ]: ... } or { "foo": ... }
        lines.push(
            `exports[${sourceCode.getText(property.key)}] = ${fixedValue};`
        )
    } else if (property.key.type === "Identifier") {
        // Regular identifier:
        // module.exports = { foo: ... }
        lines.push(`exports.${property.key.name} = ${fixedValue};`)
    } else {
        // Some other unknown property type. Conservatively give up on fixing the whole thing.
        return null
    }
    lines.push(
        ...sourceCode
            .getCommentsAfter(property)
            // @ts-expect-error getText supports both BaseNode and BaseNodeWithoutComments
            .map(comment => sourceCode.getText(comment))
    )
    return lines.join("\n")
}

/**
 * Check for a top level module.exports = { ... }
 * @param {import('estree').Node} node
 * @returns {node is {parent: import('estree').AssignmentExpression & {parent: import('estree').ExpressionStatement, right: import('estree').ObjectExpression}}}
 */
function isModuleExportsObjectAssignment(node) {
    return (
        hasParentNode(node) &&
        node.parent?.type === "AssignmentExpression" &&
        hasParentNode(node.parent) &&
        node.parent?.parent?.type === "ExpressionStatement" &&
        hasParentNode(node.parent.parent) &&
        node.parent.parent.parent?.type === "Program" &&
        node.parent.right.type === "ObjectExpression"
    )
}

/**
 * Check for module.exports.foo or module.exports.bar reference or assignment
 * @param {import('estree').Node} node
 * @returns {node is import('estree').MemberExpression}
 */
function isModuleExportsReference(node) {
    return (
        hasParentNode(node) &&
        node.parent?.type === "MemberExpression" &&
        node.parent.object === node
    )
}

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('eslint').Rule.RuleFixer} fixer
 * @returns {import('eslint').Rule.Fix | null}
 */
function fixModuleExports(node, sourceCode, fixer) {
    if (isModuleExportsReference(node)) {
        return fixer.replaceText(node, "exports")
    }
    if (!isModuleExportsObjectAssignment(node)) {
        return null
    }
    const statements = []
    const properties = node.parent.right.properties
    for (const property of properties) {
        const statement = getReplacementForProperty(property, sourceCode)
        if (statement) {
            statements.push(statement)
        } else {
            // No replacement available, give up on the whole thing
            return null
        }
    }
    return fixer.replaceText(node.parent, statements.join("\n\n"))
}

/**
 * @typedef {[
 *   ("module.exports" | "exports")?,
 *   {allowBatchAssign?: boolean}?
 * ]} RuleOptions
 */
/** @type {import('./rule-module').RuleModule<{RuleOptions: RuleOptions}>} */
module.exports = {
    meta: {
        docs: {
            description: "enforce either `module.exports` or `exports`",
            recommended: false,
            url: "https://github.com/eslint-community/eslint-plugin-n/blob/HEAD/docs/rules/exports-style.md",
        },
        type: "suggestion",
        fixable: "code",
        schema: [
            {
                //
                enum: ["module.exports", "exports"],
            },
            {
                type: "object",
                properties: { allowBatchAssign: { type: "boolean" } },
                additionalProperties: false,
            },
        ],
        messages: {
            unexpectedExports:
                "Unexpected access to 'exports'. Use 'module.exports' instead.",
            unexpectedModuleExports:
                "Unexpected access to 'module.exports'. Use 'exports' instead.",
            unexpectedAssignment:
                "Unexpected assignment to 'exports'. Don't modify 'exports' itself.",
        },
    },

    create(context) {
        const mode = context.options[0] || "module.exports"
        const batchAssignAllowed = Boolean(
            context.options[1] != null && context.options[1].allowBatchAssign
        )
        const sourceCode = getSourceCode(context)

        /**
         * Gets the location info of reports.
         *
         * exports = foo
         * ^^^^^^^^^
         *
         * module.exports = foo
         * ^^^^^^^^^^^^^^^^
         *
         * @param {import('estree').Node} node - The node of `exports`/`module.exports`.
         * @returns {import('estree').SourceLocation | undefined} The location info of reports.
         */
        function getLocation(node) {
            const token = sourceCode.getTokenAfter(node)
            if (node.loc?.start == null || token?.loc?.end == null) {
                return
            }
            return {
                start: node.loc?.start,
                end: token?.loc?.end,
            }
        }

        /**
         * Enforces `module.exports`.
         * This warns references of `exports`.
         *
         * @param {import('eslint').Scope.Scope} globalScope
         * @returns {void}
         */
        function enforceModuleExports(globalScope) {
            const exportsNodes = getExportsNodes(globalScope)
            const assignList = batchAssignAllowed
                ? createAssignmentList(getModuleExportsNodes(globalScope))
                : []

            for (const node of exportsNodes) {
                // Skip if it's a batch assignment.
                const topAssignment = getTopAssignment(node)
                if (
                    topAssignment &&
                    assignList.length > 0 &&
                    assignList.indexOf(topAssignment) !== -1
                ) {
                    continue
                }

                // Report.
                context.report({
                    node,
                    loc: getLocation(node),
                    messageId: "unexpectedExports",
                })
            }
        }

        /**
         * Enforces `exports`.
         * This warns references of `module.exports`.
         *
         * @param {import('eslint').Scope.Scope} globalScope
         * @returns {void}
         */
        function enforceExports(globalScope) {
            const exportsNodes = getExportsNodes(globalScope)
            const moduleExportsNodes = getModuleExportsNodes(globalScope)
            const assignList = batchAssignAllowed
                ? createAssignmentList(exportsNodes)
                : []
            const batchAssignList = []

            for (const node of moduleExportsNodes) {
                // Skip if it's a batch assignment.
                if (assignList.length > 0) {
                    const topAssignment = getTopAssignment(node)
                    const found = topAssignment
                        ? assignList.indexOf(topAssignment)
                        : -1
                    if (found !== -1) {
                        batchAssignList.push(assignList[found])
                        assignList.splice(found, 1)
                        continue
                    }
                }

                // Report.
                context.report({
                    node,
                    loc: getLocation(node),
                    messageId: "unexpectedModuleExports",
                    fix(fixer) {
                        return fixModuleExports(node, sourceCode, fixer)
                    },
                })
            }

            // Disallow direct assignment to `exports`.
            for (const node of exportsNodes) {
                // Skip if it's not assignee.
                if (!isAssignee(node)) {
                    continue
                }

                const topAssignment = getTopAssignment(node)
                // Check if it's a batch assignment.
                if (
                    topAssignment &&
                    batchAssignList.indexOf(topAssignment) !== -1
                ) {
                    continue
                }

                // Report.
                context.report({
                    node,
                    loc: getLocation(node),
                    messageId: "unexpectedAssignment",
                })
            }
        }

        return {
            "Program:exit"() {
                const scope = getScope(context)

                switch (mode) {
                    case "module.exports":
                        enforceModuleExports(scope)
                        break
                    case "exports":
                        enforceExports(scope)
                        break

                    // no default
                }
            },
        }
    },
}
