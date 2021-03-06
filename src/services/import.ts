import XLSX, { WorkSheet } from 'xlsx';
import { getDanhMuc } from './danh_muc';
import DBUtils from '@controller/mongodb'
import { _client, _clientGridFS } from "@db/mongodb";
import { object as convertToObject } from 'dot-object'
import { readFile } from 'fs-extra';

// import { getDanhMuc } from './danh_muc';

async function blindProcessXLSX(files: { [fieldname: string]: Express.Multer.File[] }, cacheDanhMuc: string = 'false', database: string) {
  let xlsxBuffer = await readFile(files.file[0].path)
  var workbook = XLSX.read(xlsxBuffer, { type: "buffer" });
  let sheetData = await mapConfigSheet(workbook, cacheDanhMuc, database, files.file[0].originalname, files.tepdinhkem);

  return sheetData;
}

async function mapConfigSheet(worksheet: XLSX.WorkBook, cacheDanhMuc: string = 'false', database: string, fileName: string, fileDinhKem?: Express.Multer.File[]) {
  const responseData: any = {};
  const _Sdata: any = {};
  const _Tdata: any = {};
  let _fileData: any = {};
  let lstSheet_S = worksheet.SheetNames.filter(x => x.startsWith("S_"));
  let lstSheet_T = worksheet.SheetNames.filter(x => x.startsWith("T_") && (x !== "T_TepDuLieu"));
  let lstSheet_C = worksheet.SheetNames.filter(x => x.startsWith("C_"));
  _fileData = await buildTepDuLieu(worksheet.Sheets["T_TepDuLieu"], database, fileName, fileDinhKem)
  // let lstSheet_C = worksheet.SheetNames.filter(x => x.startsWith("C_")); ignore
  for (let sheet of lstSheet_S) {
    // Build S_
    _Sdata[sheet] = await buildS_Data(worksheet.Sheets[sheet], cacheDanhMuc, database);
  }

  for (let sheet of [...lstSheet_T, ...lstSheet_C]) {
    // build T_
    _Tdata[sheet] = await buildT_Data(worksheet.Sheets[sheet], _Sdata, cacheDanhMuc, database, _fileData);
    if (Array.isArray(_Tdata[sheet])) {
      const bulkService = await DBUtils.bulkCreateOneIfNotExist(_client, {
        dbName: database,
        collectionName: sheet
      })
      for (let record of _Tdata[sheet]) {
        const dataToCreate = addMetadataImport(record, fileName);
        dataToCreate['type'] = sheet;
        await bulkService.bulkUpsertAdd({
          sourceRefId: dataToCreate['sourceRef'] + "___" + record[findFirstColumnKey(getHeaderRow(worksheet.Sheets[sheet])[0]) || Object.keys(record)[0]]
        }, dataToCreate);
      }
      try {
        responseData[sheet] = await bulkService.bulk.execute();
      }
      catch (err: any) {
        responseData[sheet] = err.message
      }
    }
    else {
      responseData.err = _Tdata[sheet];
    }
  }
  return responseData
}
function groupBy(xs: any[], key: string) {
  return xs.reduce((rv, x) => {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
};
function getHeaderRow(worksheet: any): string[] {
  let headers = [];
  var range = XLSX.utils.decode_range(worksheet['!ref'] || '');
  var C = range.s.c;
  for (C = range.s.c; C <= range.e.c; ++C) {
    var cell = worksheet[XLSX.utils.encode_cell({ c: C, r: 0 })] /* find the cell in the first row */
    var hdr = "C???t kh??ng t??n " + C; // <-- replace with your desired default 
    if (cell && cell.t) hdr = XLSX.utils.format_cell(cell);
    headers.push(hdr);
  }
  return headers;
}
async function buildS_Data(worksheet: any, cacheDanhMuc: string, database: string) {
  const sheetData: any = XLSX.utils.sheet_to_json(worksheet);
  sheetData.splice(0, 1);
  const danhMucData: any = {};
  for (let index in sheetData) {
    for (let colName in sheetData[index]) {
      if (colName.startsWith("!")) {
        //Ignore column
        delete sheetData[index][colName];
        continue;
      }
      if (colName.indexOf("___") > -1) {
        let [key, ...listConfig] = colName.split("___");
        if (key.endsWith("[]")) {
          let keyToSave = key.replace("[]", "");
          let [danhMuc, keySearch, keyToADD] = listConfig;

          //default value if not exist
          keySearch = keySearch || "TenMuc";
          keyToADD = keyToADD || "MaMuc";
          let config = {
            DanhMuc: danhMuc,
            KeySearch: keySearch,
            Fields: (keyToADD || "MaMuc").split("|"),
          }
          danhMucData[danhMuc] = danhMucData[danhMuc] || await getDanhMuc(database, config, cacheDanhMuc);
          if (danhMucData[danhMuc]) {
            let lstValue = sheetData[index][colName].split("||");
            let finalValue = [];
            for (let val of lstValue) {
              if (danhMucData[danhMuc][val]) {
                finalValue.push(danhMucData[danhMuc][val])
              }
              else {
                finalValue.push({
                  _source: {
                    [keySearch]: val
                  }
                })
              }
            }
            sheetData[index][keyToSave] = finalValue;
          }
          else {
            return {
              status: "error",
              msg: `${danhMuc} not found!`
            }
          }
          delete sheetData[index][colName];
          // Danh m???c nhi???u d??? li???u t??n c???t key[] d??? li???u ph??n c??ch b???i ||
          // 3. ${T??n field}___${T??n danh m???c}___${Key ????? t??m c???a danh m???c}___${Key k??m theo ph??n c??ch b???ng '|' }
          //   M???c ?????nh MaMuc TenMuc c?? th??? b??? tr???ng ${T??n field}___${T??n danh m???c}
          // danhMucData[config[sheet][column].DanhMuc] = await getDanhMuc(database, config[sheet][column], cacheDanhMuc);
        }
        else {
          // 3. ${T??n field}___${T??n danh m???c}___${Key ????? t??m c???a danh m???c}___${Key k??m theo ph??n c??ch b???ng '|' }
          //   M???c ?????nh MaMuc TenMuc c?? th??? b??? tr???ng ${T??n field}___${T??n danh m???c}
          // danhMucData[config[sheet][column].DanhMuc] = await getDanhMuc(database, config[sheet][column], cacheDanhMuc);
          let keyToSave = key.replace("[]", "");
          let [danhMuc, keySearch, keyToADD] = listConfig;
          //default value if not exist
          keySearch = keySearch || "TenMuc";
          keyToADD = keyToADD || "MaMuc";
          let config = {
            DanhMuc: danhMuc,
            KeySearch: keySearch,
            Fields: (keyToADD || "MaMuc").split("|"),
          }
          danhMucData[danhMuc] = danhMucData[danhMuc] || await getDanhMuc(database, config, cacheDanhMuc);
          if (danhMucData[danhMuc]) {
            if (danhMucData[danhMuc][sheetData[index][colName]]) {
              sheetData[index][keyToSave] = danhMucData[danhMuc][sheetData[index][colName]]
            }
            else {
              sheetData[index][keyToSave] = {
                _source: {
                  [keySearch]: sheetData[index][colName]
                }
              }
            }
            delete sheetData[index][colName];
          }
          else {
            return {
              status: "error",
              msg: `${danhMuc} not found!`
            }
          }
        }

      }
    }
    sheetData[index] = convertToObject(sheetData[index])
  }
  return groupBy(sheetData, getHeaderRow(worksheet)[0])
}
async function buildT_Data(worksheet: WorkSheet, _Sdata: any, cacheDanhMuc: string, database: string, _fileData: any) {
  const sheetData: any = XLSX.utils.sheet_to_json(worksheet);
  const danhMucData: any = {};
  sheetData.splice(0, 1);

  for (let index in sheetData) {

    //sheetData[index] : 1 rowData
    for (let colName in sheetData[index]) {
      //
      // Case 1. T??n c???t: "!..." => b??? c??? c???t
      // 
      if (colName.startsWith("!")) {
        //Ignore column
        delete sheetData[index][colName];
        continue;
      }

      if (colName.indexOf("___") > -1) {
        // idTest*___S_ABC|S_XYZ(AAA)
        let [key, ...listConfig] = colName.split("___");

        if (key.endsWith("*")) {
          //
          // Case 2. ${fieldToCheck}*___${SheetName}(keyToSave)
          //   - *: ????nh d???u c???t l???y d??? li???u t??? sheet kh??c
          //   - T??n Sheet: => ph??n c??ch b???ng "|" 
          //   - M???c ?????nh c???t ?????u trong c??c sheet con d??ng ????? so s??nh v???i c???t fieldToCheck ??? sheet cha
          //   - keyToSave: t??n tr?????ng l??u th??nh m???ng ??? object sheet cha. N???u kh??ng c?? s??? l???y sheetName b??? "S_". VD: S_HanNgachXaThai => HanNgachXaThai.
          // 
          sheetData[index][key.replace("*", "")] = sheetData[index][colName];
          if (listConfig[0].indexOf("|")) {
            for (let config of listConfig[0].split("|")) {
              let prebuildDataToGet = config; // S_ABC(XYZ)
              let keyToSave = key.replace("*", "");
              if (config.indexOf("(") > -1) {
                const filter = new RegExp(/(.+?)\((.+?)\)/gi);
                prebuildDataToGet = config.replace(filter, "$1"); // S_ABC
                keyToSave = config.replace(filter, "$2"); // XYZ
              }
              else {
                keyToSave = config.replace("S_", ""); // ABC
              }
              if (prebuildDataToGet === "T_TepDuLieu") {
                if (_fileData) {
                  sheetData[index][keyToSave] = _fileData[sheetData[index][colName]];
                }
              }
              else if (_Sdata[prebuildDataToGet]) {
                sheetData[index][keyToSave] = _Sdata[prebuildDataToGet][sheetData[index][colName]];
              }
            }
          }
          else {
            let prebuildDataToGet = listConfig[0]; // S_ABC(XYZ)
            let keyToSave = key.replace("*", "");
            if (listConfig[0].indexOf("(") > -1) {
              const filter = new RegExp(/(.+?)\((.+?)\)/gi);
              prebuildDataToGet = listConfig[0].replace(filter, "$1"); // S_ABC
              keyToSave = listConfig[0].replace(filter, "$2"); // XYZ
            }
            else {
              keyToSave = listConfig[0].replace("S_", ""); // ABC
            }
            if (prebuildDataToGet === "T_TepDuLieu") {
              if (_fileData) {
                sheetData[index][keyToSave] = _fileData[sheetData[index][colName]];
              }
            }
            else if (_Sdata[prebuildDataToGet]) {
              sheetData[index][keyToSave] = _Sdata[prebuildDataToGet][sheetData[index][colName]];
            }
          }
          // clean up
          delete sheetData[index][colName];
        }
        else if (key.endsWith("[]")) {
          let keyToSave = key.replace("[]", "");
          let [danhMuc, keySearch, keyToADD] = listConfig;

          //default value if not exist
          keySearch = keySearch || "TenMuc";
          keyToADD = keyToADD || "MaMuc";
          let config = {
            DanhMuc: danhMuc,
            KeySearch: keySearch,
            Fields: (keyToADD || "MaMuc").split("|"),
          }
          danhMucData[danhMuc] = danhMucData[danhMuc] || await getDanhMuc(database, config, cacheDanhMuc);
          if (danhMucData[danhMuc]) {
            let lstValue = sheetData[index][colName].split("||");
            let finalValue = [];
            for (let val of lstValue) {
              if (danhMucData[danhMuc][val]) {
                finalValue.push(danhMucData[danhMuc][val])
              }
              else {
                finalValue.push({
                  _source: {
                    [keySearch]: val
                  }
                })
              }
            }
            sheetData[index][keyToSave] = finalValue;
          }
          else {
            return {
              status: "error",
              msg: `${danhMuc} not found!`
            }
          }
          delete sheetData[index][colName];
          // Danh m???c nhi???u d??? li???u t??n c???t key[] d??? li???u ph??n c??ch b???i ||
          // 3. ${T??n field}___${T??n danh m???c}___${Key ????? t??m c???a danh m???c}___${Key k??m theo ph??n c??ch b???ng '|' }
          //   M???c ?????nh MaMuc TenMuc c?? th??? b??? tr???ng ${T??n field}___${T??n danh m???c}
          // danhMucData[config[sheet][column].DanhMuc] = await getDanhMuc(database, config[sheet][column], cacheDanhMuc);
        }
        else {
          // 3. ${T??n field}___${T??n danh m???c}___${Key ????? t??m c???a danh m???c}___${Key k??m theo ph??n c??ch b???ng '|' }
          //   M???c ?????nh MaMuc TenMuc c?? th??? b??? tr???ng ${T??n field}___${T??n danh m???c}
          // danhMucData[config[sheet][column].DanhMuc] = await getDanhMuc(database, config[sheet][column], cacheDanhMuc);
          let keyToSave = key.replace("[]", "");
          let [danhMuc, keySearch, keyToADD] = listConfig;
          //default value if not exist
          keySearch = keySearch || "TenMuc";
          keyToADD = keyToADD || "MaMuc";
          let config = {
            DanhMuc: danhMuc,
            KeySearch: keySearch,
            Fields: (keyToADD || "MaMuc").split("|"),
          }
          danhMucData[danhMuc] = danhMucData[danhMuc] || await getDanhMuc(database, config, cacheDanhMuc);
          if (danhMucData[danhMuc]) {
            if (danhMucData[danhMuc][sheetData[index][colName]]) {
              sheetData[index][keyToSave] = danhMucData[danhMuc][sheetData[index][colName]]
            }
            else {
              sheetData[index][keyToSave] = {
                _source: {
                  [keySearch]: sheetData[index][colName]
                }
              }
            }
            delete sheetData[index][colName];
          }
          else {
            return {
              status: "error",
              msg: `${danhMuc} not found!`
            }
          }
        }
      }
      else {
        // normal key text
        if (colName.endsWith("[]")) {
          let keyToSave = colName.replace("[]", "");
          sheetData[index][keyToSave] = sheetData[index][colName].split("||");
          delete sheetData[index][colName];
        }
      }
    }
  }
  return sheetData;
}

async function buildTepDuLieu(worksheet: WorkSheet, database: string, fileName: string, fileDinhKem?: Express.Multer.File[]) {
  if (!fileDinhKem) return;
  const sheetData: any = XLSX.utils.sheet_to_json(worksheet);
  sheetData.splice(0, 1);
  for (let index in sheetData) {
    sheetData[index]['fileName'] = `${sheetData[index]['TenTep']}.${sheetData[index]['DinhDang']}`;
    sheetData[index]['sourceRefId'] = `${fileName}___${sheetData[index]['IDVanBanDTM']}___${sheetData[index]['fileName']}`;
    for (let fileExpress of fileDinhKem) {
      if (fileExpress.originalname == sheetData[index].fileName) {
        let fileUploaded = await DBUtils.uploadExpressFile(_clientGridFS, "T_TepDuLieu", sheetData[index]['sourceRefId'], fileExpress);
        if (fileUploaded) {
          sheetData[index]['uploadData'] = {
            "bucketName": "T_TepDuLieu",
            "chunkSize": 102400,
            "originalname": fileUploaded.filename,
            "encoding": "7bit",
            "filename": fileUploaded.filename,
            "size": fileUploaded.chunkSizeBytes,
            "uploadDate": new Date().toISOString(),
            "id": String(fileUploaded.id),
            "contentType": fileUploaded.options.contentType || "",
          }
        }
        break;
      }
    }
    const dataToCreate = addMetadataImport(JSON.parse(JSON.stringify(sheetData[index])), fileName);
    let created = await DBUtils.createOneIfNotExist(_client, {
      dbName: database,
      collectionName: "T_TepDuLieu",
      filter: {
        sourceRefId: sheetData[index]['sourceRefId']
      },
      insertData: dataToCreate
    })
    sheetData[index]["idTepDuLieu"] = String(created.upsertedId);
  }
  return groupBy(sheetData, getHeaderRow(worksheet)[0]);
}

function addMetadataImport(record: any, fileName: string) {
  let data = record;
  data['sourceRef'] = `ImportXlsx_${fileName}`;
  data['username'] = `ImportSevice`;
  data['openAccess'] = 0;
  data['order'] = 0;
  data['site'] = 'csdl_mt';
  data['storage'] = 'regular';
  data["accessRoles"] = [
    {
      "shortName": "admin",
      "permission": "2"
    },
    {
      "shortName": "AdminData",
      "permission": "2"
    }
  ]
  return data;
}
function findFirstColumnKey(columnName: string | undefined) {
  const regx = new RegExp(/^\w+/gi);
  return columnName?.match(regx)?.[0];
}
export { blindProcessXLSX }