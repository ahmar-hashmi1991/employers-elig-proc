const Ajv = require("ajv")
const ajv = new Ajv({allErrors: true})

const SCHEMA = {
    createReseller: {
        type: "object",
        properties: {
            name:{ type: "string"},
            description:  {type: "string"},
            eligibility_rules:{
                type: "object",
                properties: {
                    productTypes: {
                        type: "array",
                        items:{ type: "string"}
                    },
                    validationFields: {
                        type: "array",
                        items:{type: ['string', 'array']}
                    }
                },
                required: ["validationFields"],
                additionalProperties: true,
            },
            configurations:{
                type: "object",
                properties : {
                    sku_mappings :{
                        type :'object',
                    },
                    sso :{
                        type :'object',
                        properties :{
                            cert_filename : {
                                type : 'string'
                            }
                        }
                    },
                    autoAssignPCP :{
                        type :'string'
                    }
                }
            },
            support_phone:{ type: "string"
            },
            support_email:  {  type: "string"},
            user_id: {type: "string"},
            reason: {type: "string"},
        },
        required: ["name", "description","eligibility_rules",
            "configurations","support_phone","support_email","user_id","reason"],
        additionalProperties: false,
    },
    createNewEmployer: {
        type: "object",
        properties: {
            external_id: { type: "string"},
            employerStatus : { type: "string"},
            sf_eligbility_account_ID : { type: "string"},
            name: { type: "string"},
            folder :{ type: "string"},
            file_name_filter: { type: "string"},
            support_phone: {type : "string"},
            support_email: {type: "string"},
            status: { type: "string"},
            structure: {
                type: "object",
                properties: {
                    'Vitality ID': {type: "string"},
                    'FirstName': {type: "string"},
                    'LastName': {type: "string"},
                    'Employee ID': {type: "string"},
                    'Date of Birth': {type: "string"},
                    'Group Name': {type: "string"},
                    'Gender': {type: "string"},
                },
                required: ["Vitality ID", "FirstName",'LastName','Employee ID','Date of Birth','Group Name','Gender'],
                additionalProperties: true,
            },
            external_ftp: { type :"boolean"},
            ftp_info :{ type : "string",
               /* properties: {
                    hostname: {type: "string"},
                    username :{ type: "string"},
                    password: {type: "string"},
                    folder: { type: "string"},
                    port: { type: "string"}
                }*/
            },
            mapping_rules:{
                type: "object"
              /*  properties:{
                    FirstName:{type: "string"},
                    LastName:{type: "string"},
                    "Email Address": {type: "string"},
                    "Phone Number" :{type: "string"},
                    "Home Phone":{type: "string"},
                    "Employee ID":{type: "string"},
                    "Vitality ID":{type: "string"},
                    Role:{type: "string"},
                    Gender:{type: "string"},
                    "Date of Birth":{type: "string"},
                    Branch :{type: "string"},
                    "Group Name":{type: "string"},
                }*/
            },
            eligibility_rules:{
                type: "object",
                properties: {
                    productTypes: {
                            type: "array",
                            items:{ type: ['string', 'object']}
                        },
                    validationFields: {
                            type: "array",
                            items:{type: ['string', 'array']}
                        },
                    validation: {type: "boolean"},
                    remove_limit: { type: "string"},
                    update_limit: {type: "string"},
                    isDeltaFile: { type: "boolean"},
                    skipIfMinor: {type: "boolean"},
                    targeting:{
                        type:"object",
                        properties:{
                            minor_age:{type:"string"},
                            default:{type:"boolean"}
                        }
                    },
                    processingPolicy:{
                        type:"object",
                        properties:{
                            duplicateRecords:{type: "string"},
                            invalidRecords:{type:"string"}
                        }
                    },
                    membership: {
                        type: "object",
                        properties:{
                            membership_plan:{type:"string"},
                            clinic:{type:"string"},
                            clinic_meta:{
                                type: "object",
                                properties:{
                                    channel:{ type: "string"},
                                    sub_channel:{type: "string"}
                                }},
                            display_name:{type:"string"},
                            checkup_call_expert:{type:"string"},
                            contact_us_email:{type:"string"},
                            contact_us_phone: {type:"string"}
                        }
                    },
                    membershipDisabled:{
                        type:"object",
                        properties:{
                            membership_plan:{type:"string"},
                            clinic:{type:"string"},
                            clinic_meta:{
                                type: "object",
                                properties:{
                                    channel:{ type: "string"},
                                    sub_channel:{type: "string"}
                                }},
                            display_name:{type:"string"},
                            checkup_call_expert:{type:"string"},
                            contact_us_email:{type:"string"},
                            contact_us_phone: {type:"string"}

                        }
                    }
                    },
            },
            file_validation:{
                type:"object"
            },
            errorHandling : {
                    type:"object",
                    properties :{
                        duplicate_record : {type : "string"},
                        invalid_record : {type : "string"},
                    }
                },
            file_mapping:{
                type:"object",
                properties: {
                    state_test: { type: "string"}
                }
            },
            record_source:{type: ["string","null"],nullable: true},
            parser_structure:{type: "string"},
            insurance_claims:{type: "string"},
            insurance_claims_last_file :{type: "string"},
            ftp_password_creation_date : {type: "string"},
            braze_stats :{type: "string"},
            user_id: {type: "string"},
            reason: {type: "string"},
        },
        required:['name','file_name_filter','support_phone','support_email',
            'status','folder','user_id','reason'],
        additionalProperties: false,
    },
    employerEnrolmentSetup:{
        type: "object",
        properties:{
            clinic_id: {type: "string"},
            eligibility_employer:{type:'string'},
            eligibility_employer_local_id:{type :'number'},
            eligibility_api_id: {type :'string'},
            eligibility_client_id:{type :'string'},
            eligibility_internal_id: {type :'string'},
            eligibility_app_reg: {type :'string'},
            eligibility_auto_prd:{type :'string'},
            eligibility_flow:{type :'string'},
            eligibility_clinical_qty:{type :'string'},
            eligibility_with_back:{type :'string'},
            eligibility_minor_warning:{type :'string'},
            eligibility_ne_name: {type :'string'},
            eligibility_employer_logo:{type :'string'},
            eligibility_ne_contact_name: {type :'string'},
            eligibility_ne_link_mask:{type :'string'},
            eligibility_limit_purchases: {type :'string'},
            eligibility_waiting_list: {type :'string'},
            eligibility_add_to_waiting_list:{type :'string'},
            eligibility_waiting_list_message: {type :'string'},
            eligibility_form_title:{type :'string'},
            eligibility_form_sub_title:{type :'string'},
            eligibility_type: {type :'string'},
            eligibility_survey:{type :'string'},
            eligibility_country: {type :'string'},
            eligibility_update_plan: {type :'string'},
            eligibility_plan: {type :'string'},
            eligibility_iphone_sku: {type :'string'},
            eligibility_usbc_sku: {type :'string'},
            eligibility_aj_sku:{type :'string'},
            eligibility_ig_sku: {type :'string'},
            eligibility_bp_m_sku:{type :'string'},
            eligibility_bp_l_sku:{type :'string'},
            eligibility_bp_gsm_sku:{type :'string'},
            eligibility_msk_sku: {type :'string'},
            eligibility_pst_sku:{type :'string'},
            eligibility_msk_pst_sku: {type :'string'},
            eligibility_msk_cva_sku: {type :'string'},
            eligibility_bh_sku:{type :'string'},
            eligibility_bh_access_code: {type :'string'},
            eligibility_eap_sku: {type :'string'},
            eligibility_wm_gsm_sku: {type :'string'},
            ineligibility_general_support_txt: {type :'string'},
            eligibility_orders:{type :'string'},
            eligibility_new_enrollment_json:{type:'object'},
            products:{type:'object'}
        },
        required:[],
        additionalProperties: false,
    }
}
module.exports = {
    validate : async(schema,data) => {
        let validate = ajv.compile(SCHEMA[schema]);
        let result = validate(data);
        if(!(!!result)){
            console.log('error result ', validate.errors)
            return {
                statusCode: 400,
                body: JSON.stringify({status: 'Bad Request', result: 'Invalid Input!'})
            };
        } else return result
}
}
