const mongoose = require('mongoose');
const { Schema } = mongoose;

class MasterRecordsModel {
    COLLECTION_NAME = 'master_records';
    
    SCHEMA = {
        emails: {
            type: [String],
            index: true,
            lowercase: true            
        },
        serial_numbers: {
            type: [String],
            index: true
        },
        user_source: {
            type: String,
            index: true
        },
        type: {
            type: String,
            index: true
        },
        order_numbers:{
            type: [Number],
            index: true
        },
        match_key: {
            type: String,
            index: true
        },
        braze_key: {
            type: String,
            index: true
        },
        plan: {
            type: String,
            index: true
        },
        overrides: Object
    };

    constructor(db){
        this._schema = new Schema(this.SCHEMA, { timestamps: true });
        this.model =  db.model(this.COLLECTION_NAME, this._schema);
    }
}

module.exports = MasterRecordsModel;