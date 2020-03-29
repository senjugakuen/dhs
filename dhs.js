'use strict'
const MJSoul = require('mjsoul')
let dhs = null
let auth = {
    account: '',
    password: '',
    eid: '' //雀魂eid
}
let contestList = {}
let taskQueue = []
let queueRuning = false
let currentContestId = 0

const searchAccount = async(param)=>{
    let eids = param.toString().split(',')
    let res
    res = await dhs.sendAsync('searchAccountByEid', {eids: eids})
    return res.search_result
}

// 增加/删除参赛人员 setting_type:1设定,2增加,3删除 返回例{total:3,success:2,nicknames:['nick1','nick2']}
const updateContestPlayer = async(setting_type, eids)=>{
    let searchResult = await searchAccount(eids)
    let account_ids = []
    let nicknames = []
    for (let v of searchResult) {
        account_ids.push(v.account_id)
        nicknames.push(v.nickname)
    }
    let result = await dhs.sendAsync(
        'updateContestPlayer',
        {
            setting_type: setting_type,
            account_ids: account_ids,
            nicknames: nicknames
        }
    )
    return {total: eids.split(',').length, success: searchResult.length, nicknames: nicknames}
}

// 所有可用api
const apis = {

    // 查询比赛基本信息
    fetchContestInfo: async()=>{
        return contestList[currentContestId]
    },

    // 查询规则
    fetchContestGameRule: async()=>{
        return (await dhs.sendAsync('fetchContestGameRule')).game_rule_setting
    },

    // 查询管理员列表 返回数组 [{account_id: 12345, nickname: '11111'}]
    fetchContestManager: async()=>{
        return (await dhs.sendAsync('fetchContestManager')).players
    },

    // 查询参赛人员列表 返回数组 [{account_id: 12345, nickname: '11111'}]
    fetchContestPlayer: async()=>{
        return (await dhs.sendAsync('fetchContestPlayer')).players
    },

    // 设置参赛人员 返回见updateContestPlayer
    updateContestPlayer: async(eids)=>{
        return await updateContestPlayer(1, eids)
    },
    // 增加参赛人员 返回见updateContestPlayer
    addContestPlayer: async(eids)=>{
        return await updateContestPlayer(2, eids)
    },
    // 删除参赛人员 返回见updateContestPlayer
    removeContestPlayer: async(eids)=>{
        return await updateContestPlayer(3, eids)
    },

    // 查询比赛公告 返回数组:[外部公告,详细公告,管理员公告]
    fetchContestNotice: async()=>{
        return (await dhs.sendAsync(
            'fetchContestNotice',
            {'notice_types': [1,2,3]}
        )).notices
    },

    // 发布比赛公告 notice_type:1外部公告,2详细公告,3管理员公告 返回{}
    updateContestNotice: async(notice_type, content)=>{
        notice_type = parseInt(notice_type)
        if (![1,2,3].includes(notice_type))
            notice_type = 1
        return await dhs.sendAsync(
            'updateContestNotice',
            {
                'notice_type': notice_type,
                'content': content
            }
        )
    },

    // 查询正在进行的比赛和准备的玩家 返回{games:[], players:[]}
    startManageGame: async()=>{
        let result = await dhs.sendAsync('startManageGame')
        await dhs.sendAsync('stopManageGame')
        return result
    },

    // 暂停比赛
    pauseGame: async(uuid)=>{
        return await dhs.sendAsync('pauseGame', {uuid: uuid})
    },
    // 恢复比赛
    resumeGame: async(uuid)=>{
        return await dhs.sendAsync('resumeGame', {uuid: uuid})
    },
    // 终止比赛
    terminateGame: async(uuid)=>{
        return await dhs.sendAsync('terminateGame', {uuid: uuid})
    },

    // 获得牌谱
    fetchContestGameRecords: async(last_index = 20)=>{
        return await dhs.sendAsync('fetchContestGameRecords', {last_index: last_index})
    },

    // 获得排名列表 返回数组
    fetchCurrentRankList: async()=>{
        return (await dhs.sendAsync('fetchCurrentRankList')).rank_list
    },

    // 开赛 返回{game_uuid: 'xxxxxx-xxxxxx-xxxxxx-xxxxxx'}
    createContestGame: async(nicknames)=>{

        // 是否随机座位
        let random_position = true
        if (nicknames[0] === '!') {
            random_position = false
            nicknames = nicknames.substr(1)
        }

        // 获得tag
        let abc = nicknames.split('||')
        nicknames = abc[0]
        let tag = abc[1] ? abc[1] : 'auto'


        let slots = [] //开赛选手
        let absent = [] //缺席者
        nicknames = nicknames.split(',')
        let players = (await apis.startManageGame()).players //查找准备中的玩家

        let i = 0
        for (let v of nicknames) {
            if (!v.length) continue
            let arr = v.trim().split(' ') //nickname(point) arr[0]是昵称 arr[1]是点数
            let account_id = 0
            let start_point = 0
            if (arr.length === 1) {
                if (slots[0] && slots[0].start_point !== undefined) {
                    account_id = 0
                    start_point = arr.shift()
                } else {
                    account_id = arr.shift()
                    start_point = undefined
                }
            } else {
                account_id = arr.shift()
                start_point = arr.pop()
            }

            // 在准备者中用昵称查找account_id，没找到标记为缺席者
            if (typeof account_id === 'string') {
                let player = players.find((player)=>player.nickname === account_id)
                if (player)
                    account_id = player.account_id
                else
                    absent.push(account_id)
            }

            let tmp = {account_id: account_id, seat: i}
            if (!isNaN(start_point) && start_point.length) {
                //设置点数的时候 点数取100倍数
                tmp.start_point = Math.floor( parseInt(start_point) / 100 ) * 100
            }
            slots.push(tmp), i++
        }

        // 有缺席者返回错误
        if (absent.length) {
            return {
                error: {
                    'message': '开赛失败。 ' + absent.toString() + ' 缺席。',
                    'code': 8999
                }
            }
        }

        // 人数不足时添加电脑
        if (slots.length < 4) {
            let rule = await apis.fetchContestGameRule() //查询规则
            let playerCount = [1,2].includes(rule.round_type) ? 4 : 3
            console.log(rule.round_type, typeof rule.round_type)
            console.log(playerCount)
            let minus = playerCount - slots.length
            while (minus > 0) {
                minus--
                let tmp = {
                    account_id: 0,
                    start_point: rule.init_point,
                    seat: i
                }
                slots.push(tmp), i++
            }
        }

        return await dhs.sendAsync(
            'createContestGame',
            {
                slots: slots,
                tag: tag,
                random_position: random_position,
                open_live: true,
                chat_broadcast_for_end: true,
                ai_level: 2
            }
        )
    },

    // renew
    renew: async()=>{
        return await fetchRelatedContestList()
    }
}

// 获得有管理权限的比赛
const fetchRelatedContestList = async()=>{
    let list = await dhs.sendAsync('fetchRelatedContestList')
    contestList = {}
    for (let v of list.contests)
        contestList[v.contest_id] = v
    return contestList
}

// 调用api
const callApi = (name, contest_id = 0, callback = ()=>{}, params = [])=>{
    taskQueue.push({
        name: name,
        contest_id: contest_id,
        callback: callback,
        params: params
    })
    checkQueue()
}

// 检查任务队列
const checkQueue = async()=>{
    if (queueRuning)
        return
    queueRuning = true
    while (taskQueue.length) {
        let task = taskQueue.shift()
        if (task.name === 'stop') {
            taskQueue = []
            task.callback()
            break
        }
        let result
        try {
            if (!contestList.hasOwnProperty(task.contest_id))
                await fetchRelatedContestList()
            if (!contestList.hasOwnProperty(task.contest_id))
                result = {
                    'error': {
                        'message': `没有赛事${task.contest_id}的管理权限，请把 ${auth.eid} 添加为赛事管理。添加后尽快绑定。`,
                        'code': 9000
                    }
                }
            else {
                if (currentContestId != task.contest_id) {
                    if (currentContestId)
                        await dhs.sendAsync('exitManageContest')
                    let unique_id = contestList[task.contest_id].unique_id
                    await dhs.sendAsync(
                        'manageContest',
                        {unique_id: unique_id}
                    )
                }
                currentContestId = task.contest_id
                try {
                    result = await apis[task.name].apply(null, task.params)
                } catch (e) {
                    if (e.error.code === 2521) {
                        e.error.message = '自动匹配模式下不能手动开赛。'
                        result = e
                    }
                    if (e.error.code === 1203) {
                        e.error.message = '游戏编号错误。'
                        result = e
                    }
                    result = e
                }
            }
        } catch (e) {
            result = e
        }
        task.callback(result)
    }
    queueRuning = false
}

// 初始化
const init = async()=>{
    try {
        await dhs.sendAsync(
            'loginContestManager',
            {account: auth.account, password: dhs.hash(auth.password)}
        )
        await fetchRelatedContestList()
    } catch (e) {
        // console.log(e)
    }
}

// 启动函数
const start = (account, password, eid, option = {})=>{
    auth.account = account
    auth.password = password
    auth.eid = eid
    dhs = new MJSoul.DHS(option)
    dhs.on('error', (e)=>{})
    dhs.open(init)  
}

// 发送停止信号
const close = (cb)=>{
    callApi('stop', 0, cb)
}

// 绑定通知事件
const on = (name, cb)=>{
    dhs.on(name, (data)=>{
        if (data.unique_id) {
            data.contest_id = parseInt(Object.keys(contestList).find(k=>contestList[k].unique_id===data.unique_id))
        }
        cb(data)
    })
}

module.exports.start = start
module.exports.close = close
module.exports.callApi = callApi
module.exports.on = on //start之后才能绑定事件

// setTimeout(async()=>{

// callApi('fetchCurrentRankList', 917746, (data)=>{
//     console.log(data)
// })

// },4000) 
