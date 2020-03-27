'use strict'
const fs = require('fs')
const moment = require('moment')
const http = require('http')
const dhs = require('./dhs')

// 加载db
let db = {}
if (fs.existsSync('./db')) {
    db = JSON.parse(fs.readFileSync('./db'))
}
// 保存db
const saveDbSync = ()=>{
    fs.writeFileSync('./db', JSON.stringify(db))
}
process.on('exit', saveDbSync)

// 启动
const config = require('./config')
dhs.start(config.account, config.password, config.eid)

const isMaster = (id)=>{
    return config.master.includes(id)
}

// 安全退出(forever或pm2自动重启)
const reboot = ()=>{
    new Promise((resolve, reject)=>{
        dhs.close(()=>resolve())
    }).then(()=>process.exit(1))
}

const callApi = async(method, cid, param)=>{
    return new Promise((resolve, reject)=>{
        dhs.callApi(method, cid, (data)=>{
            if (data.hasOwnProperty('error'))
                reject(data)
            else
                resolve(data)
        }, [param])
    })
}

const help = `-----dhs指令说明-----
第①步 在大会室后台将 ${config.eid}(查询) 设置为比赛管理
第②步 使用"dhs绑定 赛事id"指令将qq群和比赛绑定
第③步 就可以用下面的指令啦!
  dhs规则 ※查看赛事基本信息和规则
  dhs大厅 ※查看大厅中的对局，和准备中的玩家
  dhs名单 / dhs公告 / dhs排名 / dhs刷新
★添删选手和开赛等命令群管理才能使用
  dhs添加 / dhs删除 / dhs重置 
    ※例: "dhs添加 id1,id2" (只能用数字id
  dhs开赛 ※原样输入查看详细用法 
  dhs绑定 赛事id / dhs解绑`

const kaisai = `-----dhs开赛指令说明-----
①一般用法
  dhs开赛 A君,B君,C君,D君
①设置点数
  dhs开赛 A君(5000),B君(5000),C君(5000)
③固定東南西北(前面加感叹号)
  dhs开赛 !A君,B君,C君,D君
④添加电脑(没名字的就是电脑)
  dhs开赛 A君,B君,C君,(25000)
★选手不足会自动添加电脑.
　电脑若不设置点数，初始为0点
★暂时只能使用昵称开赛.`

const ranks = ["初心","雀士","雀杰","雀豪","雀圣","魂天"]
const getRank = id=>{
    id = id.toString()
    let res = ranks[id[2]-1] + id[4]
    return res ===  "魂天1" ? "魂天" : res
}
const other_rules = {
    'have_helezhongju':'和了终局',
    'have_tingpaizhongju':'听牌终局',
    'have_helelianzhuang':'和了连庄',
    'have_tingpailianzhuang':'听牌连庄',
    'have_yifa':'一发',
    'have_liujumanguan':'流局满贯',
    'have_qieshangmanguan':'切上满贯',
    'have_biao_dora':'表宝牌',
    'have_gang_biao_dora':'杠表宝牌',
    'ming_dora_immediately_open':'杠表即开',
    'have_li_dora':'里宝牌',
    'have_gang_li_dora':'杠里宝牌',
    'have_sifenglianda':'四风连打流局',
    'have_sigangsanle':'四杠散了流局',
    'have_sijializhi':'四家立直流局',
    'have_jiuzhongjiupai':'九种九牌流局',
    'have_sanjiahele':'三家和了流局',
    'have_toutiao':'头跳',
    'have_nanruxiru':'南入西入',
    'disable_multi_yukaman':'多倍役满',
    'guyi_mode':'古役'
}

const u = (res)=>{
    let failure = res.total - res.success
    return `成功${res.success}个(${res.nicknames})。` + (failure ? failure + '个ID是空号。' : '')
}

const findGid = (cid)=>{
  return parseInt(Object.keys(db).find(k=>db[k]===cid))
}

const main = async(data)=>{
    data.message = data.message.trim()
    let debug = false
    if (data.message[0] === '-') {
        debug = true
        data.message = data.message.substr(1)
    }
    if (data.message.substr(0, 3).toLowerCase() !== 'dhs')
        return
    let parmas = data.message.trim().split(' ')
    let cmd = parmas.shift().substr(3).trim()
    if (isMaster(data.user_id) && cmd === '重启') {
        reboot()
        return '好的'
    }
    let param = parmas.join("").replace(/，/g, ',')
    let gid = data.group_id
    if (!gid) return '暂时不支持私聊'
    let isAdmin = ['owner', 'admin'].includes(data.sender.role)
    let cid = 0
    if (db[gid]) cid = db[gid]
    if (cmd === '' || cmd === '帮助')
        return help
    else if (!cid && cmd !== '绑定')
        return '尚未绑定比赛。需要帮助输入: dhs'
    else {
        if (!isAdmin && ['綁定', '绑定', '解綁', '解绑', '添加', '删除', '重置', '开赛', '開賽'].includes(cmd))
            return '你没有权限'
        try {
            let res = ''
            switch (cmd) {
                case '綁定':
                case '绑定':
                    if (cid)
                        return '已经绑定过比赛了，需要先解绑才能再次绑定。'
                    cid = parseInt(param)
                    if (!cid)
                        return '请输入正确的赛事id。'
                    if (findGid(cid))
                        return cid + '已经绑定了其他群。'
                    await callApi('fetchContestInfo', cid)
                    db[gid] = cid
                    saveDbSync()
                    return cid + "绑定成功。"
                    break
                case '解綁':
                case '解绑':
                    if (!cid)
                        return '尚未绑定比赛。'
                    delete db[gid]
                    saveDbSync()
                    return cid + "解绑成功。(为了安全请务必删除大会室后台的管理权限)"
                    break
                case '更新':
                case '刷新':
                    let contestList = await callApi('renew', cid)
                    for (let k in db) {
                        if (!contestList.hasOwnProperty(db[k]))
                            delete db[k]
                    }
                    saveDbSync()
                    return '好了'
                    break
                case '規則':
                case '规则':
                    let info = await callApi('fetchContestInfo', cid)
                    let rule = await callApi('fetchContestGameRule', cid)
                    res = `[赛事ID:${info.contest_id}(${info.open?'公开':'私密'})]`
                    res += '\n赛事名: ' + info.contest_name
                    res += '\n开始日: ' + moment.unix(info.start_time).utcOffset(8).format("YYYY/M/D H:mm")
                    res += '\n结束日: ' + moment.unix(info.finish_time).utcOffset(8).format("YYYY/M/D H:mm")
                    res += '\n自动匹配: ' + (info.auto_match ? '是' : '否')
                    let hint = rule.detail_rule_v2.game_rule.bianjietishi ? '有' : '无'
                    res += '\n思考时间: ' + ['3+5秒','5+10秒','5+20秒','60+0秒'][rule.thinking_type-1] + ` (${hint}便捷提示)`
                    let required_level = rule.detail_rule_v2.extra_rule.required_level
                    if (required_level)
                        res += '\n段位限制: ' + (required_level ? getRank(required_level) : '无')
                    let max_game_count = rule.detail_rule_v2.extra_rule.max_game_count
                    if (max_game_count)
                        res += '\n局数限制: ' + max_game_count
                    res += '\n游戏类型: ' + {1:'四人東',2:'四人南',11:'三人東',12:'三人南'}[rule.round_type] + ` / ${rule.shiduan?'有':'无'}食断 / ${rule.dora_count}枚赤宝`
                    let detail = rule.detail_rule_v2.game_rule
                    res += '\n点数设定: ' + `初始${detail.init_point} / 返点${detail.fandian} / 精算${detail.jingsuanyuandian}`
                    res += '\n击飞和天边: ' + (detail.can_jifei ? `${detail.tianbian_value}点以下击飞` : '无击飞')
                    res += '\n立直棒场棒: ' + detail.liqibang_value + '点 / ' + detail.changbang_value + '点'
                    res += '\n顺位马差马: ' + `二位${detail.shunweima_2} / 三位${detail.shunweima_3}` + ([1,2].includes(rule.round_type) ? ` / 四位${detail.shunweima_4}` : '')
                    let enabled = [], disabled = []
                    for (let i in other_rules) {
                        if (i === 'disable_multi_yukaman')
                            detail[i] = !detail[i]
                        if (detail[i])
                            enabled.push(other_rules[i])
                        else
                            disabled.push(other_rules[i])
                    }
                    res += '\n关闭的规则: ' + disabled.join(', ')
                    res += '\n开启的规则: ' + enabled.join(', ')
                    return res
                    break  
                case '公告':
                    let notice = await callApi('fetchContestNotice', cid)
                    res = '\n[外部公告]\n'
                    res += notice[0]
                    res += '\n\n[详细公告]\n'
                    res += notice[1]
                    return res
                    break
                case '選手':
                case '名單':
                case '选手':
                case '名单':
                    let playerList = await callApi('fetchContestPlayer', cid)
                    res = '[参赛花名册]\n'
                    if (!playerList.length)
                        res += '(空)\n'
                    {
                        let players = []
                        for (let v of playerList)
                            players.push(v.nickname)
                        res += players.join(',')
                    }
                    return res
                    break
                case '大廳':
                case '大厅':
                    let lobby = await callApi('startManageGame', cid)
                    res = '\n[对局中]\n'
                    if (!lobby.games.length)
                        res += '(无)\n'
                    for (let v of lobby.games) {
                        let players = []
                        for (let vv of v.players) {
                            players.push(vv.nickname ? vv.nickname : '电脑')
                        }
                        res += players.join(',') + ' / ' + moment.unix(v.start_time).utcOffset(8).format("H:mm:ss") + '开始 / ' + v.game_uuid + '\n'
                    }
                    res += '\n[准备中]\n'
                    if (!lobby.games.players)
                        res += '(无)\n'
                    {
                        let players = []
                        for (let v of lobby.players)
                            players.push(v.nickname)
                        res += players.join(',')
                    }
                    return res
                    break
                case '排名':
                    let rankList = await callApi('fetchCurrentRankList', cid)
                    return rankList
                    res = '[当前排名]\n'
                    if (!rankList.length)
                        res += '(空)'
                    else
                        res += '-姓名- -总分- -对局数-'
                    for (let v of rankList) {
                        res += `\n${v.nickname} ${v.total_point} ${v.total_count}`
                    }
                    return res
                    break
                case '添加':
                    if (!param)
                        return '请输入ID'
                    res = await callApi('addContestPlayer', cid, param)
                    return '添加' + u(res)
                    break
                case '删除':
                    if (!param)
                        return '请输入ID'
                    res = await callApi('removeContestPlayer', cid, param)
                    return '删除' + u(res)
                    break
                case '重置':
                    if (!param)
                        return '请输入ID ※删除全部选手输入:"dhs重置 确认"'
                    if (param === '确认')
                        param = ''
                    res = await callApi('updateContestPlayer', cid, param)
                    return '重置' + (param !== '' ? u(res) : '成功')
                    break
                case '開賽':
                case '开赛':
                    if (!param)
                        return kaisai
                    res = await callApi('createContestGame', cid, param.replace(/！/g,'!').replace('/（/g','(').replace('/）/g',')'))
                    return '开赛成功。'
                    break
                default:
                    return help
                    break
            }
        } catch (e) {
            let error = e.error
            if (error.code === 9999)
                return '连接雀魂服务器失败，请再试一次。如果在维护就别试了。'
            if (error.code === 9997)
                return '响应超时，可能已经执行成功。'
            if (error.message)
                return error.message
            if (debug)
                return e
            return '执行失败。命令前加"-"可查看debug信息。'
        }
    }
}

// 主动发送群消息
const sendGroupMessage = (gid, msg)=>{
    if (!gid || !msg.length) return
    msg = encodeURIComponent(msg)
    let url = `http://172.17.0.2:5700/send_group_msg?group_id=${gid}&message=` + msg
    // http.get(url, ()=>{}).on('error', ()=>{})
}

// 选手 准备/取消 通知
// dhs.on('NotifyContestMatchingPlayer', (data)=>{
//     console.log(data.nickname)
//     return
//     let gid = findGid(data.contest_id)
//     let type = data.type == 1 ? ' 已准备' : ' 取消准备'
//     sendGroupMessage(gid, data.nickname + type)
// })

// 游戏开始通知
// dhs.on('NotifyContestGameStart', (data)=>{
//     let gid = findGid(data.contest_id)
//     sendGroupMessage(gid, '游戏开始: ' + data.game_uuid)
// })

// 游戏结束通知
// dhs.on('NotifyContestGameEnd', (data)=>{
//     let gid = findGid(data.contest_id)
//     sendGroupMessage(gid, '游戏结束: ' + data.game_uuid)
// })

// 公告更新
// dhs.on('NotifyContestNoticeUpdate', (data)=>{
//     let gid = findGid(data.contest_id)
//     let type = ['外部公告', '详细公告', '管理员公告'][data.notice_type - 1]
//     sendGroupMessage(gid, '赛事' + type + '更新了')
// })

module.exports = main
