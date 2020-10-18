const MongoClient = require('mongodb')
const Async = require('async')
const Express = require('express')
const CORS = require('cors')
const App = Express()
const http = require('http').Server(App)

const dbName = process.env.AVALON_EXT_DBNAME || 'avalon'
const dbUrl = process.env.AVALON_EXT_DBURL || 'mongodb://localhost:27017'
const port = process.env.AVALON_EXT_PORT || 3008

MongoClient.connect(dbUrl, {useUnifiedTopology: true},(e,c) => {
    if (e) throw e
    console.log("Connected to MongoDB successfully")

    db = c.db(dbName)

    App.use(CORS())

    App.get('/tx/:txhash',(req,res) => {
        db.collection('blocks').findOne({ "txs.hash": req.params.txhash }, { projection: { txs: { $elemMatch: { hash: req.params.txhash}}}},(error,tx) => {
            if (error)
                res.status(500).send(error)
            else if (tx && tx.txs) {
                let result = tx.txs[0]
                result.includedInBlock = tx._id
                res.send(result)
            } else
                res.status(404).send({error: 'transaction not found'})
        })
    })

    App.get('/history/:author/:lastBlock/:skip?', (req, res) => {
        let lastBlock = parseInt(req.params.lastBlock)
        let skip = parseInt(req.params.skip)
        let author = req.params.author
        let query = {
            $and: [
                { $or: [
                    {'txs.sender': author},
                    {'txs.data.target': author},
                    {'txs.data.receiver': author},
                    {'txs.data.pa': author},
                    {'txs.data.author': author}
                ]}
            ]
        }
        let filter = {
            sort: {_id: -1},
            limit: 50
        }

        if (lastBlock > 0) 
            query['$and'].push({_id: {$lt: lastBlock}})
        
        if (skip != NaN && skip > 0)
            filter.skip = skip

        db.collection('blocks').find(query, filter).toArray(function(err, blocks) {
            for (let b = 0; b < blocks.length; b++) {
                let newTxs = []
                for (let t = 0; t < blocks[b].txs.length; t++)
                    if (blocks[b].txs[t].sender === author
                    || blocks[b].txs[t].data.target === author
                    || blocks[b].txs[t].data.receiver === author
                    || blocks[b].txs[t].data.pa === author
                    || blocks[b].txs[t].data.author === author)
                        newTxs.push(blocks[b].txs[t])
                blocks[b].txs = newTxs
            }
            res.send(blocks)
        })
    })

    App.get('/rank/:key',(req,res) => {
        let sorting = {$sort: {}}
        let projecting = {
            $project: {
                _id: 0,
                name: 1,
                balance: 1,
                subs: { $size: "$followers" },
                subbed: { $size: "$follows" }
            }
        }
        let matching = {$match:{}}
        switch (req.params.key) {
            case 'balance':
                sorting.$sort.balance = -1
                break
            case 'subs':
                sorting.$sort.subs = -1
                break
            case 'leaders':
                projecting.$project.node_appr = 1
                projecting.$project.pub_leader = 1
                projecting.$project.hasVote = {
                    $gt: ['$node_appr',0]
                }
                sorting.$sort.node_appr = -1
                matching.$match.hasVote = true
                matching.$match.pub_leader = { $exists: true }
                break
            default:
                return res.status(400).send({error: 'invalid key'})
        }

        let aggregation = [projecting, sorting, {$limit: 100}]
        if (req.params.key == 'leaders')
            aggregation.push(matching)

        db.collection('accounts').aggregate(aggregation).toArray((e,r) => {
            if (e)
                return res.status(500).send(e)
            if (req.params.key != 'leaders')
                return res.send(r)
            else {
                let getStatOps = []
                for (let leader = 0; leader < r.length; leader++) {
                    getStatOps.push((cb) => db.collection('blocks').countDocuments({miner: r[leader].name},cb))
                    getStatOps.push((cb) => db.collection('blocks').countDocuments({missedBy: r[leader].name},cb))
                    getStatOps.push((cb) => db.collection('accounts').countDocuments({approves: r[leader].name},cb))
                }
                Async.parallel(getStatOps,(everyError,everyResult) => {
                    if (everyError) return res.status(500).send(everyError)
                    for (let leader = 0; leader < r.length; leader++) {
                        delete r[leader].hasVote
                        r[leader].produced = everyResult[leader*3]
                        r[leader].missed = everyResult[leader*3+1]
                        r[leader].voters = everyResult[leader*3+2]
                    }
                    res.send(r)
                })
            }
        })
    })

    App.get('/leader/:account',(req,res) => {
        if (!req.params.account)
            res.status(404).send({error: 'account is required'})
        db.collection('accounts').findOne({name: req.params.account}, (e,acc) => {
            if (e) return res.status(500).send(e)
            if (!acc) return res.status(404).send({error: 'account does not exist'})
            if (!acc.pub_leader) return res.status(404).send({error: 'account does not contain a leader key'})
            let getStatOps = [
                (cb) => db.collection('blocks').countDocuments({miner: req.params.account},cb),
                (cb) => db.collection('blocks').countDocuments({missedBy: req.params.account},cb),
                (cb) => db.collection('accounts').countDocuments({approves: req.params.account},cb)
            ]
            Async.parallel(getStatOps,(errs,stats) => {
                if (errs) return res.status(500).send(errs)
                res.send({
                    name: acc.name,
                    balance: acc.balance,
                    node_appr: acc.node_appr,
                    pub_leader: acc.pub_leader,
                    subs: acc.followers.length,
                    subbed: acc.follows.length,
                    produced: stats[0],
                    missed: stats[1],
                    voters: stats[2]
                })
            })
        })
    })

    http.listen(port,()=>console.log('Extended API server listening on port '+port))
})