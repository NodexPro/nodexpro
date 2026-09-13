export type LegalIdentifierPresentation = {
  text: string;
  dir: 'ltr';
  unicodeBidi: 'isolate';
};

export function legalIdentifierPresentation(value: string): LegalIdentifierPresentation {
  return {
    text: value,
    dir: 'ltr',
    unicodeBidi: 'isolate',
  };
}

export function legalIdentifierCodepoints(value: string): string[] {
  return [...value];
}
