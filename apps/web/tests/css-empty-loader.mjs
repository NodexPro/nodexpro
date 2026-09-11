export async function resolve(specifier, context, nextResolve) {
  if (typeof specifier === 'string' && specifier.endsWith('.css')) {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export default {}',
    };
  }
  return nextResolve(specifier, context);
}
