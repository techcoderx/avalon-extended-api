const parallel = require('run-parallel')
const max_batch_blocks = 100000

let indexer = {
    headBlock: 0,
    processedBlocks: 0,
    leaders: {
        dtube: {
            produced: 1,
            missed: 0,
            voters: 1 // genesis
        }
    },
    updates: {
        leaders: []
    },
    blocks: [],
    batchLoadBlocks: (start) => new Promise((rs,rj) => {
        if (indexer.blocks.length == 0) 
            db.collection('blocks').find({_id: { $gte: start, $lt: start+max_batch_blocks }}).toArray((e,blocks) => {
                if (e) return rj(e)
                if (blocks) indexer.blocks = blocks
                rs(indexer.blocks.shift())
            })
        else
            rs(indexer.blocks.shift())
    }),
    processBlock: (block) => {
        if (!block)
            throw new Error('Cannnot process undefined block')

        // Setup new leader accounts
        if (!indexer.leaders[block.miner])
            indexer.leaders[block.miner] = {
                produced: 0,
                missed: 0,
                voters: 0
            }
        if (block.missedBy && !indexer.leaders[block.missedBy])
            indexer.leaders[block.missedBy] = {
                produced: 0,
                missed: 0,
                voters: 0
            }
        
        // Increment produced/missed
        indexer.leaders[block.miner].produced += 1
        if (block.missedBy) indexer.leaders[block.missedBy].missed += 1

        if (!indexer.updates.leaders.includes(block.miner))
            indexer.updates.leaders.push(block.miner)

        if (block.missedBy && !indexer.updates.leaders.includes(block.missedBy))
            indexer.updates.leaders.push(block.missedBy)

        // Look for approves/disapproves in tx
        for (let i = 0; i < block.txs.length; i++)
            if (block.txs[i].type === 1) {
                // APPROVE_NODE_OWNER
                if (!indexer.leaders[block.txs[i].data.target]) indexer.leaders[block.txs[i].data.target] = {
                    produced: 0,
                    missed: 0,
                    voters: 0
                }
                indexer.leaders[block.txs[i].data.target].voters += 1
                if (!indexer.updates.leaders.includes(block.txs[i].data.target))
                    indexer.updates.leaders.push(block.txs[i].data.target)
            } else if (block.txs[i].type === 2) {
                // DISAPPROVE_NODE_OWNER
                if (!indexer.leaders[block.txs[i].data.target]) indexer.leaders[block.txs[i].data.target] = {
                    produced: 0,
                    missed: 0,
                    voters: 0
                }
                indexer.leaders[block.txs[i].data.target].voters -= 1
                if (!indexer.updates.leaders.includes(block.txs[i].data.target))
                    indexer.updates.leaders.push(block.txs[i].data.target)
            } else if (block.txs[i].type === 18 && !indexer.leaders[block.txs[i].sender]) {
                // ENABLE_NODE
                indexer.leaders[block.txs[i].sender] = {
                    produced: 0,
                    missed: 0,
                    voters: 0
                }
                if (!indexer.updates.leaders.includes(block.txs[i].sender))
                    indexer.updates.leaders.push(block.txs[i].sender)
            }
        
        indexer.processedBlocks = block._id
    },
    buildIndex: async (blockNum,cb) => {
        let block = await indexer.batchLoadBlocks(blockNum)
        if (!block) {
            console.log('Finished indexing '+(blockNum-1)+' blocks')
            return cb()
        }
        if (blockNum % max_batch_blocks === 0)
            console.log('INDEXED BLOCK ' + blockNum)
        indexer.processBlock(block)
        indexer.buildIndex(blockNum+1,cb)
    },
    writeIndex: (cb) => {
        let ops = []
        for (let acc in indexer.updates.leaders)
            ops.push((cb) => db.collection('leaders').updateOne({_id:indexer.updates.leaders[acc]},{
                $set: indexer.leaders[indexer.updates.leaders[acc]]
            },{ upsert: true },() => cb(null,true)))
        ops.push((cb) => {
            db.collection('extended-api-index').updateOne({_id:'index-state'},{
                $set: { processedBlocks: indexer.processedBlocks }
            },{ upsert: true },() => cb(null,true))
        })
        parallel(ops,() => {
            indexer.updates.leaders = []
            cb()
        })
    },
    loadIndex: (cb) => {
        db.collection('leaders').find({},{}).toArray((e,leaders) => {
            if (leaders) for (let i in leaders) {
                indexer.leaders[leaders[i]._id] = leaders[i]
                delete indexer.leaders[leaders[i]._id]._id
            }
            db.collection('extended-api-index').findOne({_id:'index-state'},(e,state) => {
                if (state) indexer.processedBlocks = state.processedBlocks
                cb()
            })
        })
    },
    stream: () => {
        setInterval(() => {
            db.collection('blocks').findOne({},{ 
                sort: { _id: -1 },
                projection: { _id: 1 }
            },(err, count) => indexer.headBlock = count._id)
        },3000)

        setInterval(() => {
            if (indexer.processedBlocks < indexer.headBlock) {
                db.collection('blocks').findOne({ _id: indexer.processedBlocks+1 },{},(err, block) => {
                    indexer.processBlock(block)
                    indexer.writeIndex(() => {})
                })
            }
        },1500)
    }
}

module.exports = indexer