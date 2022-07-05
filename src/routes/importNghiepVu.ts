import { processXLSX, getMetaDataXLSX, previewXLSX } from '@controller/xlsx';
import express from 'express';
import multer from 'multer';
var upload = multer();

const router = express.Router();
router.post('/importXlsx/preview', upload.single('file'), async function (req, res) {
  if (req.file) {
    const metadata = await previewXLSX(req.file?.buffer, req.body.config, +req.body.previewNo + 1)
    res.status(200).send(metadata)
  }
  else {
    res.status(400).send('File not found');
  }
})

router.post('/importXlsx/confirmed', upload.single('file'), async function (req, res) {
  if (req.file) {
    const metadata = await processXLSX(req.file?.buffer, req.body.config)
    res.status(200).send(metadata)
  }
  else {
    res.status(400).send('File not found');
  }
})

router.post('/importXlsx/getMetadata', upload.single('file'), async function (req, res) {
  if (req.file) {
    const metadata = await getMetaDataXLSX(req.file?.buffer)
    res.status(200).send(metadata)
  }
  else {
    res.status(400).send('File not found');
  }
})
export default router