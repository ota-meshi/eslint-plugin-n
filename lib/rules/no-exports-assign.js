/**
 * @author Toru Nagashima <https://github.com/mysticatea>
 * See LICENSE file in root directory for full license.
 */
"use strict"

const { findVariable } = require("@eslint-community/eslint-utils")
const { getScope } = require("../util/eslint-compat")

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').Scope.Scope} scope
 * @returns {boolean}
 */
function isExports(node, scope) {
    let variable = null

    return (
        node != null &&
        node.type === "Identifier" &&
        node.name === "exports" &&
        (variable = findVariable(scope, node)) != null &&
        variable.scope.type === "global"
    )
}

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').Scope.Scope} scope
 * @returns {boolean}
 */
function isModuleExports(node, scope) {
    let variable = null

    return (
        node != null &&
        node.type === "MemberExpression" &&
        !node.computed &&
        node.object.type === "Identifier" &&
        node.object.name === "module" &&
        node.property.type === "Identifier" &&
        node.property.name === "exports" &&
        (variable = findVariable(scope, node.object)) != null &&
        variable.scope.type === "global"
    )
}

/** @type {import('./rule-module').RuleModule} */
module.exports = {
    meta: {
        docs: {
            description: "disallow the assignment to `exports`",
            recommended: true,
            url: "https://github.com/eslint-community/eslint-plugin-n/blob/HEAD/docs/rules/no-exports-assign.md",
        },
        fixable: null,
        messages: {
            forbidden:
                "Unexpected assignment to 'exports' variable. Use 'module.exports' instead.",
        },
        schema: [],
        type: "problem",
    },
    create(context) {
        return {
            AssignmentExpression(node) {
                const scope = getScope(context)

                if (
                    !isExports(node.left, scope) ||
                    // module.exports = exports = {}
                    (node.parent.type === "AssignmentExpression" &&
                        node.parent.right === node &&
                        isModuleExports(node.parent.left, scope)) ||
                    // exports = module.exports = {}
                    (node.right.type === "AssignmentExpression" &&
                        isModuleExports(node.right.left, scope))
                ) {
                    return
                }

                context.report({ node, messageId: "forbidden" })
            },
        }
    },
}
