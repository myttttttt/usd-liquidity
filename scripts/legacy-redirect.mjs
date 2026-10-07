// Builds a reversible Pages deployment copy only; source page and history remain intact.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const DESTINATION='https://lazyrs.trade/liquidity';
export const legacyRedirectHtml=`<!doctype html><html lang="zh-Hant-HK"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>市場流動性 | RS Terminal</title><link rel="canonical" href="${DESTINATION}"><meta http-equiv="refresh" content="0;url=${DESTINATION}"><p>市場流動性已搬到 <a href="${DESTINATION}">RS Terminal</a>。</p><script>location.replace(${JSON.stringify(DESTINATION)}+location.hash);</script></html>`;
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await writeFile(resolve('site/index.html'),legacyRedirectHtml);
