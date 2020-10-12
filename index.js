const MongoClient = require('mongodb')
const Express = require('express')
const CORS = require('cors')
const App = Express()
const http = require('http').Server(App)

const dbName = 'avalon'
const dbUrl = 'mongodb://localhost:27017'

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

    http.listen(3008,()=>console.log('Extended API server listening on port 3008'))
})