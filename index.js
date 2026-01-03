// TRPG跑团助手 - SillyTavern扩展
// 版本: 1.0.0

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { registerSlashCommand } from "../../../slash-commands.js";

// 扩展名称
const extensionName = "trpg-helper";
const extensionFolderPath = `scripts/extensions/third_party/${extensionName}`;

// 默认设置
const defaultSettings = {
    gameStyle: "wuxia",
    showPanel: true,
    autoRoll: false,
    language: "zh"
};

// 游戏风格配置
const gameStyles = {
    wuxia: {
        name: "东方武侠",
        attributes: ["力道", "身法", "内力", "根骨", "悟性", "机缘"],
        skills: ["剑法", "刀法", "拳脚", "暗器", "轻功", "内功", "医术", "毒术", "机关", "琴棋书画"],
        resources: { hp: "气血", mp: "内力", stamina: "体力" }
    },
    fantasy: {
        name: "史诗奇幻",
        attributes: ["力量", "敏捷", "体质", "智力", "感知", "魅力"],
        skills: ["剑术", "弓箭", "格斗", "潜行", "察觉", "说服", "欺骗", "奥术", "神术", "自然"],
        resources: { hp: "生命值", mp: "法力值", stamina: "耐力" }
    }
};

// 当前角色数据
let currentCharacter = null;

// 战斗状态
let combatState = {
    active: false,
    round: 0,
    turn: 0,
    participants: []
};
// ==================== 骰子系统 ====================

// 解析骰子表达式 (如"2d6+3")
function parseDiceExpression(expression) {
    const regex = /(\d+)?d(\d+)([+-]\d+)?/i;
    const match = expression.match(regex);
    
    if (!match) return null;
    
    return {
        count: parseInt(match[1]) || 1,
        sides: parseInt(match[2]),
        modifier: parseInt(match[3]) || 0
    };
}

// 投骰子
function rollDice(sides, count = 1) {
    const results = [];
    for (let i = 0; i < count; i++) {
        results.push(Math.floor(Math.random() * sides) + 1);
    }
    return results;
}

// 完整骰子投掷（带表达式）
function rollDiceExpression(expression) {
    const parsed = parseDiceExpression(expression);
    if (!parsed) {
        return { success: false, error: "无效的骰子表达式" };
    }
    
    const rolls = rollDice(parsed.sides, parsed.count);
    const sum = rolls.reduce((a, b) => a + b, 0);
    const total = sum + parsed.modifier;
    
    return {
        success: true,
        expression: expression,
        rolls: rolls,
        sum: sum,
        modifier: parsed.modifier,
        total: total
    };
}

// 格式化骰子结果
function formatRollResult(result) {
    if (!result.success) {
        return `❌ ${result.error}`;
    }
    
    let text = `🎲 【投骰】${result.expression}\n`;
    text += `骰子: [${result.rolls.join(", ")}] = ${result.sum}`;
    
    if (result.modifier !== 0) {
        const sign = result.modifier > 0 ? "+" : "";
        text += ` ${sign}${result.modifier}`;
    }
    
    text += `\n结果: ${result.total}`;
    
    return text;
}
// ==================== 技能检定系统 ====================

// 进行技能检定
function skillCheck(skillName, dc, bonus = 0) {
    const roll = rollDice(20, 1)[0];
    const total = roll + bonus;
    const success = total >= dc;
    
    // 判断大成功/大失败
    let resultType = success ? "success" : "failure";
    if (roll === 20) resultType = "critical_success";
    if (roll === 1) resultType = "critical_failure";
    
    return {
        skillName: skillName,
        roll: roll,
        bonus: bonus,
        total: total,
        dc: dc,
        success: success,
        resultType: resultType
    };
}

// 格式化检定结果
function formatCheckResult(result) {
    const resultText = {
        critical_success: "🌟 大成功！",
        success: "✅ 成功",
        failure: "❌ 失败",
        critical_failure: "💀 大失败！"
    };
    
    let text = `🎯 【${result.skillName}检定】\n`;
    text += `骰子: ${result.roll}`;
    
    if (result.bonus !== 0) {
        const sign = result.bonus > 0 ? "+" : "";
        text += ` ${sign}${result.bonus}`;
    }
    
    text += ` = ${result.total} vs DC${result.dc}\n`;
    text += `结果: ${resultText[result.resultType]}`;
    
    return text;
}

// 属性检定
function attributeCheck(attribute, dc) {
    if (!currentCharacter) {
        return { success: false, error: "请先创建角色" };
    }
    
    const attrValue = currentCharacter.attributes[attribute] || 10;
    const modifier = Math.floor((attrValue - 10) / 2);
    
    return skillCheck(attribute, dc, modifier);
}
// ==================== 角色系统 ====================

// 创建新角色
function createCharacter(name, style = "wuxia") {
    const config = gameStyles[style];
    
    const character = {
        name: name,
        style: style,
        level: 1,
        experience: 0,
        attributes: {},
        skills: {},
        resources: {
            hp: { current: 100, max: 100 },
            mp: { current: 50, max: 50 },
            stamina: { current: 100, max: 100 }
        },
        inventory: [],
        notes: ""
    };
    
    // 初始化属性
    config.attributes.forEach(attr => {
        character.attributes[attr] = 10;
    });
    
    // 初始化技能
    config.skills.forEach(skill => {
        character.skills[skill] = 0;
    });
    
    currentCharacter = character;
    saveCharacterData();
    
    return character;
}

// 保存角色数据
function saveCharacterData() {
    if (currentCharacter) {
        extension_settings[extensionName].character = currentCharacter;
        saveSettingsDebounced();
    }
}

// 加载角色数据
function loadCharacterData() {
    if (extension_settings[extensionName]?.character) {
        currentCharacter = extension_settings[extensionName].character;
    }
}

// 修改资源值
function modifyResource(resource, amount) {
    if (!currentCharacter) {
        return { success: false, error: "请先创建角色" };
    }
    
    const res = currentCharacter.resources[resource];
    if (!res) {
        return { success: false, error: "无效的资源类型" };
    }
    
    const oldValue = res.current;
    res.current = Math.max(0, Math.min(res.max, res.current + amount));
    const newValue = res.current;
    
    saveCharacterData();
    
    return {
        success: true,
        resource: resource,
        oldValue: oldValue,
        newValue: newValue,
        change: amount
    };
}

// 获取角色状态文本
function getCharacterStatus() {
    if (!currentCharacter) {
        return "❌ 尚未创建角色";
    }
    
    const config = gameStyles[currentCharacter.style];
    const res = currentCharacter.resources;
    
    let text = `📋 【${currentCharacter.name}】 Lv.${currentCharacter.level}\n`;
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `${config.resources.hp}: ${res.hp.current}/${res.hp.max}\n`;
    text += `${config.resources.mp}: ${res.mp.current}/${res.mp.max}\n`;
    text += `${config.resources.stamina}: ${res.stamina.current}/${res.stamina.max}\n`;
    text += `━━━━━━━━━━━━━━━━━━`;
    
    return text;
}
// ==================== 战斗系统 ====================

// 开始战斗
function startCombat(enemies = []) {
    combatState = {
        active: true,
        round: 1,
        turn: 0,
        participants: []
    };
    
    // 添加玩家
    if (currentCharacter) {
        const initiative = rollDice(20, 1)[0];
        combatState.participants.push({
            name: currentCharacter.name,
            type: "player",
            initiative: initiative,
            hp: currentCharacter.resources.hp.current,
            maxHp: currentCharacter.resources.hp.max
        });
    }
    
    // 添加敌人
    enemies.forEach((enemy, index) => {
        const initiative = rollDice(20, 1)[0];
        combatState.participants.push({
            name: enemy.name || `敌人${index + 1}`,
            type: "enemy",
            initiative: initiative,
            hp: enemy.hp || 50,
            maxHp: enemy.hp || 50
        });
    });
    
    // 按先攻排序
    combatState.participants.sort((a, b) => b.initiative - a.initiative);
    
    return formatCombatStatus();
}

// 下一回合
function nextTurn() {
    if (!combatState.active) {
        return "⚠️ 当前没有进行中的战斗";
    }
    
    combatState.turn++;
    
    // 检查是否新回合
    if (combatState.turn >= combatState.participants.length) {
        combatState.turn = 0;
        combatState.round++;
    }
    
    return formatCombatStatus();
}

// 结束战斗
function endCombat() {
    combatState.active = false;
    return "⚔️ 战斗结束！";
}

// 格式化战斗状态
function formatCombatStatus() {
    if (!combatState.active) {
        return "当前没有进行中的战斗";
    }
    
    let text = `⚔️ 【战斗】第${combatState.round} 回合\n`;
    text += `━━━━━━━━━━━━━━━━━━\n`;
    
    combatState.participants.forEach((p, index) => {
        const marker = index === combatState.turn ? "▶ " : "  ";
        const hpBar = createHpBar(p.hp, p.maxHp);
        text += `${marker}${p.name} ${hpBar} ${p.hp}/${p.maxHp}\n`;
    });
    
    text += `━━━━━━━━━━`;
    
    return text;
}

// 创建HP条
function createHpBar(current, max) {
    const percentage = current / max;
    const filled = Math.round(percentage * 10);
    const empty = 10 - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}
// ==================== 随机事件生成器 ====================

// 武侠风格事件
const wuxiaEvents = [
    "一位神秘的蒙面剑客挡住了你的去路，似乎在等待什么人。",
    "你发现路边有一具尸体，身上的伤口是某种罕见的暗器所致。",
    "一个衣衫褴褛的老乞丐向你讨要食物，但他的眼神却深不可测。",
    "远处传来兵器交击之声，似乎有人正在激战。",
    "你在客栈中听到有人在密谈一个惊天秘密。",
    "一封神秘的飞镖信钉在你房间的门上。",
    "你遇到了一位自称是某大门派弟子的年轻人，请求你的帮助。",
    "天空突然变色，江湖传言中的异象出现了。",
    "你发现了一本残破的武功秘籍，但似乎缺少关键的几页。",
    "一位故人的后代找到了你，带来了一个尘封多年的消息。"
];

// 奇幻风格事件
const fantasyEvents = [
    "一道奇异的光芒从远处的废墟中闪过。",
    "你在路边发现了一个受伤的精灵，她似乎在逃避什么。",
    "一个神秘的商人向你兜售一件据说有魔力的物品。",
    "天空中出现了一条龙的身影，正朝某个方向飞去。",
    "你收到了来自冒险者公会的紧急任务通知。",
    "一个孩子跑来告诉你，村子里出现了奇怪的事情。",
    "你的武器突然发出微弱的光芒，似乎在感应什么。",
    "一位垂死的骑士将一个神秘的徽章交给了你。",
    "你发现了一个隐藏的地下入口，里面传来奇怪的声音。",
    "一个预言家拦住你，说你将改变这个世界的命运。"
];

// 生成随机事件
function generateRandomEvent() {
    const style = extension_settings[extensionName]?.gameStyle || "wuxia";
    const events = style === "wuxia" ? wuxiaEvents : fantasyEvents;
    const event = events[Math.floor(Math.random() * events.length)];
    
    return `🎭 【随机事件】\n${event}`;
}

// 生成随机遭遇战
function generateEncounter() {
    const style = extension_settings[extensionName]?.gameStyle || "wuxia";
    
    const wuxiaEnemies = [
        { name: "山贼", hp: 30 },
        { name: "邪派弟子", hp: 45 },
        { name: "江湖杀手", hp: 60 },
        { name: "魔教护法", hp: 80 }
    ];
    
    const fantasyEnemies = [
        { name: "哥布林", hp: 25 },
        { name: "兽人战士", hp: 50 },
        { name: "骷髅法师", hp: 40 },
        { name: "食人魔", hp: 75 }
    ];
    
    const enemies = style === "wuxia" ? wuxiaEnemies : fantasyEnemies;
    const count = Math.floor(Math.random() * 3) + 1;
    const selectedEnemies = [];
    
    for (let i = 0; i < count; i++) {
        const enemy = enemies[Math.floor(Math.random() * enemies.length)];
        selectedEnemies.push({ ...enemy });
    }
    
    return startCombat(selectedEnemies);
}
// ==================== 斜杠命令 ====================

function registerCommands() {
    // /roll 命令
    registerSlashCommand("roll", (args) => {
        const expression = args.trim() || "1d20";
        const result = rollDiceExpression(expression);
        return formatRollResult(result);
    }, [], "投骰子，例如: /roll 2d6+3", true, true);
    
    // /check 命令
    registerSlashCommand("check", (args) => {
        const parts = args.trim().split(" ");
        if (parts.length < 2) {
            return "用法: /check <技能名> <难度> [加值]";
        }
        const skillName = parts[0];
        const dc = parseInt(parts[1]) || 10;
        const bonus = parseInt(parts[2]) || 0;
        const result = skillCheck(skillName, dc, bonus);
        return formatCheckResult(result);
    }, [], "技能检定，例如: /check 剑法 15 3", true, true);
    
    // /hp 命令
    registerSlashCommand("hp", (args) => {
        const amount = parseInt(args.trim()) || 0;
        const result = modifyResource("hp", amount);
        if (!result.success) return result.error;
        const config = gameStyles[currentCharacter.style];
        return `💗 ${config.resources.hp}: ${result.oldValue} → ${result.newValue}`;
    }, [], "调整HP，例如: /hp -10 或 /hp +5", true, true);
    
    // /mp 命令
    registerSlashCommand("mp", (args) => {
        const amount = parseInt(args.trim()) || 0;
        const result = modifyResource("mp", amount);
        if (!result.success) return result.error;
        const config = gameStyles[currentCharacter.style];
        return `💙 ${config.resources.mp}: ${result.oldValue} → ${result.newValue}`;
    }, [], "调整MP，例如: /mp -5", true, true);
    
    // /status 命令
    registerSlashCommand("status", () => {
        return getCharacterStatus();
    }, [], "显示角色状态", true, true);
    
    // /event 命令
    registerSlashCommand("event", () => {
        return generateRandomEvent();
    }, [], "生成随机事件", true, true);
    
    // /combat 命令
    registerSlashCommand("combat", (args) => {
        const action = args.trim().toLowerCase();
        switch (action) {
            case "start":
                return generateEncounter();
            case "next":
                return nextTurn();
            case "end":
                return endCombat();
            case "status":
                return formatCombatStatus();
            default:
                return "用法: /combat <start|next|end|status>";
        }
    }, [], "战斗控制: /combat start|next|end|status", true, true);
}
// ==================== UI界面 ====================

function createUI() {
    const html = `
    <div id="trpg-panel" class="trpg-panel">
        <div class="trpg-header">
            <span>🎲TRPG跑团助手</span>
            <button id="trpg-toggle" class="trpg-toggle">−</button>
        </div><div id="trpg-content" class="trpg-content">
            <!-- 游戏风格选择 -->
            <div class="trpg-section">
                <label>游戏风格:</label>
                <select id="trpg-style">
                    <option value="wuxia">东方武侠</option>
                    <option value="fantasy">史诗奇幻</option>
                </select>
            </div>
            
            <!-- 快速骰子 -->
            <div class="trpg-section">
                <label>快速骰子:</label>
                <div class="trpg-dice-buttons">
                    <button class="trpg-dice" data-dice="d4">D4</button>
                    <button class="trpg-dice" data-dice="d6">D6</button>
                    <button class="trpg-dice" data-dice="d8">D8</button>
                    <button class="trpg-dice" data-dice="d10">D10</button>
                    <button class="trpg-dice" data-dice="d12">D12</button>
                    <button class="trpg-dice" data-dice="d20">D20</button>
                </div>
            </div>
            
            <!-- 自定义骰子 -->
            <div class="trpg-section">
                <label>自定义:</label>
                <div class="trpg-custom-roll">
                    <input type="text" id="trpg-custom-dice" placeholder="2d6+3">
                    <button id="trpg-roll-custom">投掷</button>
                </div>
            </div>
            
            <!-- 角色管理 -->
            <div class="trpg-section">
                <label>角色:</label>
                <div class="trpg-buttons">
                    <button id="trpg-create-char">创建角色</button>
                    <button id="trpg-show-status">显示状态</button>
                </div>
            </div>
            
            <!-- 战斗控制 -->
            <div class="trpg-section">
                <label>战斗:</label>
                <div class="trpg-buttons">
                    <button id="trpg-combat-start">开始战斗</button>
                    <button id="trpg-combat-next">下一回合</button>
                    <button id="trpg-combat-end">结束战斗</button></div>
            </div>
            
            <!-- 随机生成 -->
            <div class="trpg-section">
                <label>生成器:</label>
                <div class="trpg-buttons">
                    <button id="trpg-random-event">随机事件</button>
                    <button id="trpg-encounter">遭遇战</button>
                </div>
            </div>
            
            <!-- 结果显示 -->
            <div class="trpg-section">
                <div id="trpg-result" class="trpg-result"></div>
            </div>
        </div>
    </div>
    `;
    
    // 添加到页面
    $("body").append(html);
}
// 显示结果
function showResult(text) {
    $("#trpg-result").html(text.replace(/\n/g, "<br>"));
}

// 发送消息到聊天
function sendToChat(text) {
    const context = getContext();
    if (context && context.sendSystemMessage) {
        context.sendSystemMessage("generic", text);
    }
    showResult(text);
}

// 绑定UI事件
function bindEvents() {
    // 折叠/展开面板
    $("#trpg-toggle").on("click", function() {
        const content = $("#trpg-content");
        const btn = $(this);
        if (content.is(":visible")) {
            content.slideUp();
            btn.text("+");
        } else {
            content.slideDown();
            btn.text("−");
        }
    });
    
    // 游戏风格切换
    $("#trpg-style").on("change", function() {
        extension_settings[extensionName].gameStyle = $(this).val();
        saveSettingsDebounced();
    });
    
    // 快速骰子按钮
    $(".trpg-dice").on("click", function() {
        const dice = $(this).data("dice");
        const result = rollDiceExpression("1" + dice);
        sendToChat(formatRollResult(result));
    });
    
    // 自定义骰子
    $("#trpg-roll-custom").on("click", function() {
        const expression = $("#trpg-custom-dice").val() || "1d20";
        const result = rollDiceExpression(expression);
        sendToChat(formatRollResult(result));
    });
    
    // 创建角色
    $("#trpg-create-char").on("click", function() {
        const name = prompt("请输入角色名称:", "无名侠客");
        if (name) {
            const style = $("#trpg-style").val();
            createCharacter(name, style);
            sendToChat(`✅ 角色【${name}】创建成功！`);
        }
    });
    
    // 显示状态
    $("#trpg-show-status").on("click", function() {
        sendToChat(getCharacterStatus());
    });
    
    // 战斗控制
    $("#trpg-combat-start").on("click", function() {
        sendToChat(generateEncounter());
    });
    
    $("#trpg-combat-next").on("click", function() {
        sendToChat(nextTurn());
    });
    
    $("#trpg-combat-end").on("click", function() {
        sendToChat(endCombat());
    });
    
    // 随机生成
    $("#trpg-random-event").on("click", function() {
        sendToChat(generateRandomEvent());
    });
    
    $("#trpg-encounter").on("click", function() {
        sendToChat(generateEncounter());
    });
}
// ==================== 初始化 ====================

// 加载设置
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    
    // 应用默认设置
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }
    
    // 加载角色数据
    loadCharacterData();
    
    // 更新UI
    $("#trpg-style").val(extension_settings[extensionName].gameStyle);
}

// jQuery入口
jQuery(async () => {
    console.log("TRPG跑团助手: 正在加载...");
    
    // 创建UI
    createUI();
    
    // 绑定事件
    bindEvents();
    
    // 加载设置
    loadSettings();
    
    // 注册命令
    registerCommands();
    
    console.log("TRPG跑团助手: 加载完成！");
});
