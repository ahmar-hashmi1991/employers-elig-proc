
const flexAPI = require('../services/vitality-flex-api-service');
const db = require('../services/rds-data-service');
const eligibilityHandler = require('../handlers/s3-csv-handler');
const queue = require('../services/sqs-service');

const VitalityExternalID = 'Ikkqa3';


const response = (res, err) => {
  return {
    statusCode: err ? '400' : '200',
    body: err ? JSON.stringify({ success: false, error: err.message }) : JSON.stringify(res),
    headers: {
      'Content-Type': 'application/json',
    },
  }
};

const getShopLineItems = async (orderLines) => {
  const [reseller] = await db.getResellerByExternalID(VitalityExternalID);
  if (!reseller[0] || !reseller[0].configurations) {
    console.log('ERROR: Failed recieving reseller');
    return [];
  }
  let configurations;
  try {
    configurations = JSON.parse(reseller[0].configurations);
  } catch (err) {
    console.log('ERROR: Failed parsing reseller configurations');
  }

  if (!configurations || !configurations.sku_mappings) {
    console.log('ERROR: Failed parsing sku mappings');
    return [];
  }

  const mappings = configurations.sku_mappings;
  let line_items = [];
  for (let i = 0; i < orderLines.length; i++) {
    let orderLine = orderLines[i];
    if (!orderLine.sku || !orderLine.quantity) {
      console.log(`ERROR: Bad Order Line ${JOSN.stringify(orderLine)}`);
      continue;
    }
    let product = mappings[orderLine.sku];
    if (product) { //membership sku
      line_items.push({ sku: product.shop_sku, quantity: orderLine.quantity, type: product.type });
    } else {
      console.log(`ERROR: Unknown Product ${orderLine.sku}`);
    }
  }
  return line_items;

};

const createEligibilityRecordObject = (record, firstName, lastName, zip, employer, memberId, employerId, role) => {
  return {
    eid: record.eid,
    employer_id: employer.id,
    first_name: firstName,
    last_name: lastName,
    email: record.email,
    address_1: record.address1,
    address_2: "",
    city: record.city,
    state: record.state,
    zipcode: zip,
    employee_id: "",
    reseller_employee_id: memberId,
    group_name: employerId,
    role: role,
    targeting: record.targeting
  };
};

const handleEligibility = async (order_data, employer) => {
  const shippingAddress = order_data.shippingAddress;
  //check if eligiblility record exists
  let [eligiblity_rows] = await db.getEligibilityByFields('email = (?)', [order_data.shippingAddress.email]);
  let eligiblity_data = eligiblity_rows[0];

  let [[fileHID_rows]] = await Promise.all([
    db.getFileHistoryByFileName(`flex_api`)
  ]);

  let fileHID = fileHID_rows[0].id;
  console.log(`employer ${JSON.stringify(employer)}`);
  console.log(`fileHID ${JSON.stringify(fileHID)}`);

  //if not add to eligibility list+
  if (!eligiblity_data) {
    let tmp_eligiblity_data = createEligibilityRecordObject(shippingAddress, shippingAddress.firstName, shippingAddress.lastName, shippingAddress.zip, employer.id, order_data.memberId, order_data.employerId, "EE");
    const [eligDbRecords] = await db.getEmployerEligibilityList(employer.id);
    const employee = await eligibilityHandler.getEmployeeBySpouseCheckField(tmp_eligiblity_data, employer, eligDbRecords);
    const result = eligibilityHandler.createNewEligibility(tmp_eligiblity_data, employer, fileHID, 1, 1, null, null, employee.eid);
    let res = await queue.sendBatch([result]);
    console.log(`Created Eligibility Record ${JSON.stringify(tmp_eligiblity_data)}`, JSON.stringify(res));
    eligiblity_data = JSON.parse(JSON.stringify(tmp_eligiblity_data));
  } else {
    eligiblity_data = createEligibilityRecordObject(eligiblity_data, eligiblity_data.first_name, eligiblity_data.last_name, eligiblity_data.zipcode, employer.id, eligiblity_data.reseller_employee_id, eligiblity_data.group_name, eligiblity_data.role);
    console.log(`Found Eligibility Record ${JSON.stringify(eligiblity_data)}`);
  }
  eligiblity_data.employer_id = employer.external_id;
  return eligiblity_data;
};

const getTestOrderData = async (order_id) => {
  let [[tmp_order]] = await db.getVitatlityMockOrders(order_id);
  let dateISOString = new Date().toISOString();
  let date = dateISOString.slice(0, dateISOString.indexOf('.')) + '+0000';

  let order_lines = JSON.parse(tmp_order.orderLines);
  let shipping_address = JSON.parse(tmp_order.shippingAddress);
  return {
    "output": {
      "orderId": order_id,
      "memberId": tmp_order.memberId,
      "employerId": tmp_order.employerId,
      "orderDate": date,
      "orderLines": order_lines,
      "shippingAddress": shipping_address
    },
    "status": 1
  };
};

/**
  * Process Requests from Eligibility API GW for Vitality Flex.
  */
exports.handleAPIRequest = async (event, context) => {
  console.log('event', event);
  let operationName = event.requestContext.operationName;
  let body = JSON.parse(event.body);
  const [[employer]] = await db.getEmployer('70000')
  console.log(`${operationName}`, body);

  try {
    switch (`${operationName}`) {
      case 'orderNotification':
        if (!body.resourceId || !body.eventType) {
          return response({ success: false }, new Error(`ERROR: Missing Basic Parameters`));
        }
        let order = {};
        if (body.eventType === 'order_created') {
          if (body.darioTestOrder) {
            order = await getTestOrderData(body.resourceId)
          } else {
            order = await flexAPI.getOrder(body.resourceId);
          }

          console.log("ORDER: ", JSON.stringify(order));
          if (order.status === 1 && order.output.orderId) {
            let [eligiblity, line_items] = await Promise.all([
              handleEligibility(order.output, employer),
              getShopLineItems(order.output.orderLines)
            ]);
            //convert SKUs
            if (line_items.length > 0) {
              order.output.orderLines = line_items;
              order.output.eligibilityData = eligiblity;
              //create shop order
              //check if this order has already been created.
              const [[createdShopOrder]] = await db.getEmployerOrder(order.output.orderId, employer.id);
              //create shop order if not already created before.
              if(!createdShopOrder){
                let queueData = await queue.getShopParams(order.output, employer.id);
                let queueRes = await queue.sendBatch([queueData]);
                console.log("Sending to Queue result", JSON.stringify(queueRes));
              }
            } else {
              console.log(`ERROR: Empty line items`);
              return response({ success: false }, new Error(`ERROR: Product Validation Failed`));
            }
          } else {
            console.log(`ERROR: fatching order information`);
            return response({ success: false }, new Error(`ERROR: Missing order information`));
          }
        } else if (body.eventType === 'events_reward') {
          let response = await flexAPI.sendEvents(body.memberId, body.eventCode);
          console.log("Events Response", JSON.stringify(response));
        }
        break;
      default:
        return response({ success: false }, new Error(`ERROR: Unsupported Operation`));
    }
  }
  catch (error) {
    console.log(error);
    console.log(error.message);
    return response({ success: false }, new Error(`ERROR: Uknown Error Occured`));
  }
  return response({ success: true });
};

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
