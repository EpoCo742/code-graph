import express from 'express';
import { catalogRouter } from './routes/catalog';

const app = express();
app.use(express.json());
app.use('/v1/catalog', catalogRouter);
app.get('/healthz', (_req, res) => res.send('ok'));
app.listen(8080);
