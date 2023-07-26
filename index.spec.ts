import {createParseFunction} from './index';

import type {OnCommentError, OnCommentParse, OnParse} from './index';

declare const process: {env: {_START: string}};

export type OnParseWithMaxLength = OnParse<{}, 32>;
// @ts-expect-error
export type OnParseThatExceedsMaxLength = OnParse<{}, 33>;

let testsCount = 0;

function assert(value: unknown, message: string): asserts value is true {
  if (value !== true) {
    throw new TypeError(`❌ Assert "${message}" fails`);
  }

  testsCount += 1;

  console.log(' ✅', message);
}

const ok = (message: string) => console.log(`\x1B[32m[OK]\x1B[39m ${message}`);
const startTestsTime = Date.now();

ok(`Build passed in ${startTestsTime - Number(process.env._START)}ms!`);

const throwError = (message: string): void => {
  throw new Error(message);
};

const emptyParse = createParseFunction({
  onError: (_context, _source, message) => throwError(message),
});

emptyParse({}, '');
emptyParse({}, 'foo');

try {
  createParseFunction({statements: [{tokens: ['}']}]});
  throwError('Unexpected error');
} catch (error) {
  assert(error instanceof SyntaxError, 'createParseFunction throw SyntaxError for invalid regexps');
}

type Context = Readonly<{
  errors: unknown[];
  exports: [exports: string, ...comments: string[]][];
  imports: [import: string, ...comments: string[]][];
  multilineComments: string[];
  singlelineComments: string[];
}>;

const onCommentError: OnCommentError<Context> = (_context, source, {start}) => {
  throwError(source.slice(start));
};

const onCommentParse: OnCommentParse<Context> = (
  {singlelineComments},
  source,
  openToken,
  closeToken,
) => {
  assert(
    Array.isArray(openToken.match) && Array.isArray(closeToken.match),
    'comments tokens has "match"',
  );

  singlelineComments.push(source.slice(openToken.end, closeToken.start));
};

const onError: OnParse<Context> = ({errors}, source, ...tokens) => {
  const lastToken = tokens[tokens.length - 1]!;

  errors.push(source.slice(tokens[0]!.start, lastToken.end + 30));

  assert(
    tokens.every((token) => Array.isArray(token.match)),
    'errors tokens has "match"',
  );

  if ('comments' in lastToken) {
    const comments = lastToken.comments.map((pair) => getCommentSource(source, pair));

    throwError(`Found extra comments in last error tokens ("${comments.join('", "')}")`);
  }
};

const getCommentSource = (
  source: string,
  pair: readonly [{end: number}, {start: number}],
): string => source.slice(pair[0].end, pair[1].start);

const onExportParse: OnParse<Context, 2> = ({exports}, source, exportStart, exportEnd) => {
  const exportStartComments = exportStart.comments?.map((pair) => getCommentSource(source, pair));

  assert(
    Array.isArray(exportStart.match) && Array.isArray(exportEnd.match),
    'exports tokens has "match"',
  );

  if (exportEnd.match.groups?.['constName']) {
    assert(exportEnd.match.groups['constName'] === 'qux', 'produce correct groups from match');
  }

  exports.push([source.slice(exportStart.end, exportEnd.start), ...(exportStartComments || [])]);
};

const onImportParse: OnParse<Context, 3> = ({imports}, source, importStart, importEnd) => {
  const importStartComments = importStart.comments?.map((pair) => getCommentSource(source, pair));

  assert(
    Array.isArray(importStart.match) && Array.isArray(importEnd.match),
    'imports tokens has "match"',
  );

  imports.push([source.slice(importStart.end, importEnd.start), ...(importStartComments || [])]);
};

const parseImportsExports = createParseFunction<Context>({
  comments: [
    {
      onError: onCommentError,
      onParse: onCommentParse,
      tokens: ['\\/\\/', '$\\n?'],
    },
    {
      onError: onCommentError,
      onParse: ({multilineComments}, source, {end}, {start}) => {
        multilineComments.push(source.slice(end, start));
      },
      tokens: ['\\/\\*', '\\*\\/'],
    },
  ],
  onError: (_context, _source, message) => throwError(message),
  statements: [
    {
      onError,
      onParse: onImportParse as OnParse,
      tokens: ['^import ', '("[^"]*";?$\\n?)|(\'[^\']*\';?$\\n?)'],
    },
    {
      onError,
      onParse: onExportParse as OnParse,
      tokens: [
        '^export ',
        '(\\bconst (?<constName>[\\w_$][\\w_$\\d]*)\\b)|("[^"]*";?$\\n?)|(\'[^\']*\';?$\\n?)',
      ],
    },
  ],
});

const importsExports: Context = {
  errors: [],
  exports: [],
  imports: [],
  multilineComments: [],
  singlelineComments: [],
};

parseImportsExports(
  importsExports,
  `
import {foo} from './foo';
import bar from './bar'

// This is a comment

import /* some comment */ bar from bar;

'also import from bar;'

import bar from './baz'

export {foo} /* also comment} */ from 'baz';
export const qux = 2;
export /* comment in export} */ {bar} from "bar";

import with error;
import // comment in import without from;
`,
);

assert(importsExports.errors.length === 2, 'creates errors');
assert(importsExports.exports.length === 3, 'parse exports');
assert(importsExports.imports.length === 4, 'parse imports');
assert(importsExports.singlelineComments.length === 2, 'parse singleline comments');
assert(importsExports.multilineComments.length === 3, 'parse multiline comments');

parseImportsExports(importsExports, '');
parseImportsExports(importsExports, '                         ');

const errorContext: string[] = [];

const errorParse = createParseFunction<string[]>({
  onError: (context, _source, message) => {
    context.push(message);
  },
  statements: [{tokens: ['a)|b|(c']}, {tokens: ['d', 'e)|f|(g']}],
});

errorParse(errorContext, '');
assert(errorContext.length === 0, 'no error for empty source');

errorParse(errorContext, 'b');
assert(errorContext.length === 1, 'produce one global error');
assert(
  errorContext[0]!.includes('Cannot find statements or comments by regexp'),
  'produce expected global error',
);

errorParse(errorContext, 'ab');
assert(errorContext.length === 2, 'produce second global error');
assert(errorContext[1]!.endsWith('at index 1'), 'produce error with correct index');

errorParse(errorContext, 'd');
assert(errorContext.length === 2, 'no global error for statement error');

errorParse(errorContext, 'df');
assert(errorContext.length === 3, 'produce third global error');
assert(
  errorContext[2]!.includes('Cannot find next part of statement d or comments by regexp'),
  'produce expected global for part of statement',
);

try {
  parseImportsExports(importsExports, '/* comment with error');
  throwError('Unexpected error');
} catch (error: unknown) {
  assert(String(error).includes('comment with error'), 'produce correct comment error');
}

ok(`All ${testsCount} tests passed in ${Date.now() - startTestsTime}ms!`);
