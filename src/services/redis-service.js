const redis = require("redis");
const bluebird = require("bluebird");

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

class Database {
    constructor() {
        if (!Database.instance) {
            console.log(`Creating REDIS Database instance...`);
            Database.instance = this;
            this.promise = new Promise(function(resolve, reject) {
                let client = redis.createClient(`redis://${process.env.REDIS_URL}:6379`);
                client.on('connect', () => {
                    console.log('Redis client is connected');
                    resolve(client);
                });
                
                client.on("error",(err) =>{
                    console.log('ERROR in redis connect', err);
                    reject(err);
                }); 
            });
        }

        return Database.instance;
    }
}

/// APIS
module.exports = {
    get: async (key) => {
        const client_redis = await new Database().promise;
        return await client_redis.getAsync(key);
    },
    set: async (key, value, ttl) => {
        const client_redis = await new Database().promise;
        return await client_redis.setexAsync(key, ttl, value);
    }
}
