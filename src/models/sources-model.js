const mongoose = require('mongoose');
const { Schema } = mongoose;

class SourcesModel {
    COLLECTION_NAME = 'sources_model';
    
    SCHEMA = {
        api_source: {
            type: String,
            index: true
        },
        user_source: {
            type: String,
            index: true
        },
        type: String
    };

    constructor(db){
        this._schema = new Schema(this.SCHEMA, { });
        this.model =  db.model(this.COLLECTION_NAME, this._schema);
    }
}

module.exports = SourcesModel;