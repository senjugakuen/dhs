'use strict'
module.exports = {
	port: 3001, //监听的端口
	allowed: ["::ffff:172.17.0.2"], //允许连接的地址，空则无限制
	dhs_url: 'wss://gateway-v2.majsoul.com:6001', //雀魂后台地址，一般不用修改
	eid: 25331349, //雀魂加好友ID
	master: [372914165] //主人QQ列表
}
