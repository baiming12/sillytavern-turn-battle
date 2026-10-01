import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { CORE_PACK } from '../content.js';
import { generateWriterWorldbook } from '../worldbook.js';

const directory = new URL('../examples/', import.meta.url);
await mkdir(directory, { recursive: true });
const starterPack = JSON.parse(await readFile(new URL('基础测试内容包.json', directory), 'utf8'));
await writeFile(new URL('写卡助手世界书.json', directory), `${JSON.stringify(generateWriterWorldbook([CORE_PACK, starterPack]), null, 2)}\n`, 'utf8');
const fantasyPack = JSON.parse(await readFile(new URL('基础西幻职业技能包.json', directory), 'utf8'));
await writeFile(new URL('西幻写卡助手世界书.json', directory), `${JSON.stringify(generateWriterWorldbook([CORE_PACK, fantasyPack]), null, 2)}\n`, 'utf8');
