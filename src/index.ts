import fs from 'fs';
import glob from 'glob';
import path from 'path';

import { Progress } from './progress';
import { runner } from './runner';

export type Options = {
  files?: string[];
  alias?: Record<string, string>;
  extensions?: string[];
  complete?:
    | boolean
    | {
        js?: boolean;
        jsx?: boolean;
        ts?: boolean;
        tsx?: boolean;
        vue?: boolean;
      };
  log?: boolean;
};

export function extMigrator(options: Options = {}) {
  const extensions = [
    'js',
    'ts',
    'jsx',
    'tsx',
    'vue',
    'scss',
    'css',
    ...(options.extensions || []),
  ];
  const complete =
    typeof options.complete === 'boolean'
      ? extensions.reduce(
          (prev, next) => ({ ...prev, [next]: options.complete }),
          {},
        )
      : {
          vue: true,
          scss: true,
          css: true,
          ...options.complete,
        };

  const files: string[] = (options.files || ['src/**/*'])
    .map((item) =>
      glob.sync(item, {
        nodir: true,
        matchBase: "*.+(${extensions.join('|')})",
      }),
    )
    .flat();

  const tasks: (() => any)[] = [];
  const progress = new Progress({
    title: '[ext-migrator]',
  });

  files.forEach((filepath) => {
    const categoryImports = getCategoryImports(
      fs.readFileSync(filepath).toString(),
      extensions,
    );
    for (const extension in categoryImports) {
      if (extension === 'none') {
        for (const key in complete) {
          if (complete[key] === true) {
            tasks.push(
              createCompleteTask(
                progress,
                filepath,
                categoryImports.none,
                key,
                options.alias,
                options.log,
              ),
            );
          }
        }
      } else if (complete[extension] === false) {
        tasks.push(
          createRemoveTask(
            progress,
            filepath,
            categoryImports[extension],
            extension,
            options.log,
          ),
        );
      }
    }
  });
  progress.setTotal(tasks.length);

  const startTime = Date.now();
  return runner(tasks).then(() => {
    const time = (Date.now() - startTime) / 1000;
    // eslint-disable-next-line no-console
    console.log(`[ext-migrator] ${tasks.length} files: ${time} s`);
  });
}

function createCompleteTask(
  progress: Progress,
  filepath: string,
  imports: string[],
  extension: string,
  alias: Record<string, string>,
  log?: boolean,
) {
  return () => {
    progress.tick('complete: ' + filepath);
    imports.forEach((item) => {
      const newImport = tryFindFile(filepath, item, [extension], alias);
      if (newImport === item) {
        return;
      }
      writeFileImport(filepath, item, newImport, log);
    });
  };
}

function createRemoveTask(
  progress: Progress,
  filepath: string,
  imports: string[],
  extension: string,
  log?: boolean,
) {
  return () => {
    progress.tick('remove: ' + filepath);
    imports.forEach((item) => {
      const newImport = item.replace(new RegExp(`(/index)?.${extension}$`), '');
      if (newImport === item) {
        return;
      }
      writeFileImport(filepath, item, newImport, log);
    });
  };
}

function tryFindFile(
  filepath: string,
  importPath: string,
  extensions: string[],
  alias: Record<string, string> = {},
) {
  const extensionsPattern = `.+(${extensions.join('|')})`;
  const filepathAbsolute = toAbsolutePath(filepath, importPath, alias);

  let path: string = glob.sync(`${filepathAbsolute}${extensionsPattern}`)[0];
  if (!path) {
    path = glob.sync(`${filepathAbsolute}/index${extensionsPattern}`)[0];
  }

  return path ? importPath + path.replace(filepathAbsolute, '') : importPath;
}

function writeFileImport(
  filepath: string,
  oldImport: string,
  newImport: string,
  log?: boolean,
) {
  log &&
    // eslint-disable-next-line no-console
    console.log(`
- filepath: ${filepath}
- oldImport: ${oldImport}
- newImport: ${newImport}
  `);
  const content = fs.readFileSync(filepath).toString();
  fs.writeFileSync(filepath, content.replace(oldImport, newImport));
}

function toAbsolutePath(
  filepath: string,
  importPath: string,
  alias: Record<string, string> = {},
) {
  for (const key in alias) {
    const aliasPath = path.resolve(alias[key]);
    if (importPath === key || importPath.startsWith(key)) {
      return importPath.replace(key, aliasPath);
    }
  }
  return path.resolve(path.dirname(filepath), importPath);
}

function getCategoryImports(content: string, extensions: string[]) {
  const result: Record<string, string[]> = {
    none: [],
  };
  const imports = getImports(content);
  imports.forEach((item) => {
    const find = extensions.find((extension) => item.endsWith('.' + extension));
    if (find) {
      if (!result[find]) result[find] = [];
      result[find].push(item);
    } else {
      result.none.push(item);
    }
  });
  return result;
}

/**
 * 获取导入地址
 * import {} from '...'
 * import '...'
 * require('...')
 * import('...')
 * @import('...')
 * @import url('...')
 */
function getImports(content: string) {
  return (
    removeComments(content)
      .match(
        new RegExp(
          '(from\\s+|import\\s+|require\\(|import\\(|@import\\s+(url\\()?)(\'|").+(\'|")',
          'g',
        ),
      )
      ?.map((item) => item.replace(/.*['"](.+)['"].*/, '$1')) || []
  );
}

/**
 * 移除注释代码
 * - //
 * - /*
 * - *
 * - <
 */
function removeComments(content: string) {
  return content.replace(/^\s*(\/\/|\/\*|\*|<).*$/gm, '');
}
