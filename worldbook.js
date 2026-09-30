import { CONTENT_TYPES, PACK_SCHEMA, REQUEST_SCHEMA } from './content.js';

function entry(uid, title, content, keys = [], constant = false, order = 100) {
    return {
        uid, comment: title, key: keys, keysecondary: [], content,
        constant, selective: false, selectiveLogic: 0, disable: false,
        order, position: 0, probability: 100, useProbability: false,
        depth: 4, excludeRecursion: true, matchWholeWords: false,
    };
}

export function generateWriterWorldbook(catalog = '') {
    const entries = [
        entry(0, '回合战斗格式总则', `你正在为“回合战斗”插件编写内容。只在用户要求生成战斗内容包或角色卡战斗适配时输出对应结构化数据。内容包格式版本：${PACK_SCHEMA}；开战快照格式版本：${REQUEST_SCHEMA}。\n输出必须是纯 JSON，不要 Markdown 代码围栏、解释文字或脚本。所有定义使用“包ID:条目ID”形式的唯一 ID。引用必须指向同批次定义或用户提供的现有目录。技能条件和效果只能使用下列格式指导条目支持的种类。给技能、装备、道具和状态各写一个 description，描述供剧情 AI 写外观与动作，不代替规则字段。生成后自检 ID、引用、数值范围和装备栏位。`, [], true, 200),
        entry(1, '内容包外层结构', `生成批量导入内容时使用一个 JSON 对象：{"schema":"${PACK_SCHEMA}","id":"小写包ID","name":"内容包名称","version":"1.0.0","skills":[],"statuses":[],"equipment":[],"items":[],"allies":[],"enemies":[],"aiProfiles":[]}。allies 是我方角色预设，enemies 是敌人预设。各数组可一次批量包含多个条目，定义的 id 必须以包ID和冒号开头。装备授予的技能、状态以及道具效果中的状态/装备，全部用 ID 引用。`, ['批量导入', '内容包', 'DLC'], false, 170),
        entry(2, '技能格式', `技能条目示例：{"id":"demo:fireball","name":"火球术","description":"咏唱后凝成炽热火球，飞向指定目标并炸开。","tags":["magic","mouth","chant"],"cost":{"mp":5},"target":{"side":"enemy","row":"any","count":"single","guard":false},"requirements":[{"kind":"freePart","part":"mouth"},{"kind":"equippedAnyTag","tags":["staff","spellbook"]}],"effects":[{"kind":"damage","damageType":"magic","power":6,"scale":1}]}。description 写剧情可见的动作和表现；数值、前提、目标与效果分别写在规则字段。target.side 用 enemy/ally/self；row 用 front/back/any；count 用 single/all；guard=false 表示无视前排保护。原本只能选前排的技能若带 melee 标签，施放者进入敌方前排后也可攻击后排；释放前提照常检查。条件：freePart、equippedTag、equippedAnyTag、enemyFrontEmpty、targetEquipped、targetNotEquipped、selfNotEquipped、selfEquipment、targetEquipment、selfNotEquipment、targetNotEquipment、selfStatus、targetStatus、selfNotStatus、targetNotStatus。指定装备使用 equipmentId，指定状态使用 statusId。效果：damage、resource、status、removeStatus、equipRestraint、removeRestraint、disarm、removeEquipment、disableEquipment、infiltrate、actionPoints。disableEquipment 指定 slot 与正整数 duration。概率 chance 为 0–100 数字。`, ['技能', '剑法', '法术', '攻击'], false, 160),
        entry(3, '道具与装备格式', `道具使用与技能相同的 target、requirements、effects 字段；例如石灰粉：{"id":"demo:lime","name":"石灰粉","description":"一把细粉扬向敌人面部。","target":{"side":"enemy","row":"front","count":"single","guard":false},"effects":[{"kind":"status","statusId":"demo:blind","chance":70}]}。装备示例：{"id":"demo:staff","name":"法杖","description":"杖身刻着暗淡纹路，施法时泛起微光。","slot":"weapon","tags":["staff"],"stats":{"matk":2},"skills":[]}。装备 description 写外观和剧情用途；属性、授予技能与状态分别写在规则字段。slot 可用 weapon、outer、middle、underwear、legs、feet、accessory、restraint。拘束装备额外设置 parts、statuses、escapeChance、escapeCost；parts 用 hands、feet、mouth、body。法术书属于 weapon，法术卷轴属于 items。`, ['道具', '装备', '武器', '饰品', '拘束'], false, 150),
        entry(4, '状态与角色预设格式', `状态示例：{"id":"demo:blind","name":"失明","description":"视线模糊，难以瞄准目标。","duration":2,"maxStacks":1,"accuracyMod":-30,"tags":["debuff"]}；可用 blockedTags 限制技能标签、stats 修改属性、bonusAp 提供 0–3 点额外行动点、skills 授予技能、suppressedSkills 封锁指定技能。技能或道具用 status/removeStatus 效果施加或解除状态。装备也可有 bonusAp。我方角色预设放在 allies，敌人预设放在 enemies，均可包含 id、name、row、col、stats、resources、skills、equipment、accessories、restraints、statuses；敌人还可包含 items、aiProfile。我方道具统一写入开战快照外层 bag，不放在单个角色里。AI 策略示例：{"id":"demo:guard-ai","name":"守卫","skillPriority":["demo:guard-hit"],"itemPriority":[],"useItems":true}。剧情 AI 每场仍要写入完整初始快照；预设只是建议值，不能替代当前剧情变量。`, ['Buff', 'Debuff', '我方角色', '敌人预设', '状态', 'AI策略'], false, 140),
        entry(5, '角色卡开战快照适配', `如果用户要求你编写角色卡的战斗变量与开战格式：剧情变量名可自由设计，但开战时必须把当前变量映射成 ${REQUEST_SCHEMA} 的 JSON。外层字段：schema、scene、actors、bag。每名 actor 至少包含 id、name、side(ally/enemy)、row(front/back)、col(从1开始)、stats、resources；resources 中 hp/sp/mp 各为 {"current":数值,"max":数值}，可另加自定义资源；另可填 skills、equipment、accessories、restraints、statuses、items、aiProfile。玩家方道具数量只在外层 bag 填一次；敌方道具写在各自 actor.items。剧情中学会或失去技能、取得或失去装备、换装、增减道具时，先更新剧情变量；下次开战把当前完整的 skills、equipment、accessories、restraints、statuses、bag 等写进快照，不能重新套用预设初始值。战斗结束时按报告完整状态同步变量。只能引用已启用目录中的 ID；新技能或装备必须先创建内容定义、导入并绑定，剧情 AI 不得仅靠快照临时发明定义。开战回复的剧情停在第一项行动前，在末尾输出 HTML 注释标记：<!-- TURN_BATTLE_REQUEST 换行 JSON 换行 -->。`, ['写卡', '角色卡', '开战格式', '战斗变量'], false, 130),
    ];
    if (catalog.trim()) entries.push(entry(6, '已有内容目录', `写作时可引用的已有内容定义如下。不要使用目录以外且未在同批次创建的 ID：\n${catalog}`, ['现有内容', '引用目录'], false, 120));
    return { entries: Object.fromEntries(entries.map(e => [String(e.uid), e])) };
}

export function buildStoryPrompt(catalog = '') {
    return `当本轮剧情即将进入战斗时，正文必须停在第一项战斗行动之前。不要提前写出招、命中、伤害、倒下或胜负。依据当前角色卡变量生成完整初始状态，在回复末尾输出：\n<!-- TURN_BATTLE_REQUEST\n{"schema":"${REQUEST_SCHEMA}","scene":"地点与导火索","actors":[{"id":"player","name":"角色名","side":"ally","row":"front","col":1,"stats":{"patk":10,"matk":5,"pdef":5,"mdef":5},"resources":{"hp":{"current":30,"max":30},"sp":{"current":20,"max":20},"mp":{"current":10,"max":10}},"skills":[],"equipment":{},"accessories":[],"restraints":[],"statuses":[]},{"id":"enemy","name":"敌人","side":"enemy","row":"front","col":1,"stats":{"patk":8,"matk":0,"pdef":4,"mdef":2},"resources":{"hp":{"current":20,"max":20},"sp":{"current":10,"max":10},"mp":{"current":0,"max":0}},"skills":[],"equipment":{},"accessories":[],"restraints":[],"statuses":[],"items":{}}],"bag":{}}\n-->\n上面的 JSON 是格式样例，实际输出必须填写本场所有参战者与当前值。目录中的 description 供剧情描写，实际效果以插件的规则字段和战斗报告为准。若目录含 allies 或 enemies 角色预设，只作为建议模板；剧情中学会或失去技能、取得或失去装备、换装以及道具变化，都要先更新剧情变量，下次开战完整写入当前 skills、equipment、accessories、restraints、statuses、bag 和资源，不要恢复为模板初始值。普通剧情不要输出该标记。每个 ID 必须来自当前卡启用内容目录；如果剧情出现目录外的新技能或装备，需先由用户创建并启用对应内容定义，不能只在快照中写新 ID。战斗结束后根据玩家提供的战斗报告续写，并把最终技能、资源、道具、装备和状态同步到剧情变量，不改写战斗结果。${catalog ? `\n当前卡启用内容目录（包含绑定条目的引用）：\n${catalog}` : ''}`;
}

export function worldbookSummary(book) {
    return Object.values(book.entries || {}).map(e => `${e.comment}${e.constant ? '（常驻）' : `：${e.key.join('、')}`}`).join('\n');
}
