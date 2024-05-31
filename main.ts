// @deno-types="npm:@types/express@4.17.15"
import express from "npm:express@4.18.2";
import cors from "npm:cors";

import { v1 } from "https://deno.land/std@0.224.0/uuid/mod.ts";
import { Indier } from "npm:indier";

const app = express();
const kv = await Deno.openKv();

app.use(cors());
app.use(express.json());

const indier = new Indier({
  apiKey: 'indier_b53a23b1-1c34-4e2e-995a-181d6ab10fe5'
})

interface Monitor {
  id: string;
  name: string;
  url: string;
  method: string;
  owner: string;
}

interface MonitorLog {
  id: string;
  monitorId: string;
  statusCode: number;
  responseTime: number;
  owner: string;
  data: {
    body: string;
    headers: Headers;
  };
  createdAt: string;
}

// Middleware para verificar o header x-channel
app.use((req, res, next) => {
  const channel = req.headers['x-channel'];
  if (!channel) {
    return res.status(400).json({ error: 'x-channel header is required' });
  }
  next();
});

// Endpoint para adicionar um novo monitor
app.post('/monitors', async (req, res) => {
  const { name, url, method } = req.body;
  const owner = req.headers['x-channel'] as string;

  if (!name || !url || !method) {
    return res.status(400).json({ error: 'Name, URL, and method are required' });
  }

  const id = v1.generate() as string;
  const monitor: Monitor = { id, name, url, method, owner };

  await kv.set(['monitors', owner, id], monitor);

  res.status(201).json(monitor);
});

// Endpoint para listar todos os monitores de um usuário
app.get('/monitors', async (req, res) => {
  const owner = req.headers['x-channel'] as string;
  const monitors: Monitor[] = [];

  const records = kv.list({ prefix: ['monitors', owner] });
  for await (const entry of records) {
    monitors.push(entry.value as Monitor);
  }

  res.json(monitors);
});

// Endpoint para atualizar um monitor
app.put('/monitors/:id', async (req, res) => {
  const { id } = req.params;
  const { name, url, method } = req.body;
  const owner = req.headers['x-channel'] as string;

  const monitorKey = ['monitors', owner, id];
  const monitor = await kv.get<Monitor>(monitorKey);

  if (!monitor.value) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const updatedMonitor: Monitor = {
    ...monitor.value,
    name: name ?? monitor.value.name,
    url: url ?? monitor.value.url,
    method: method ?? monitor.value.method,
  };

  await kv.set(monitorKey, updatedMonitor);

  res.json(updatedMonitor);
});

// Endpoint para deletar um monitor
app.delete('/monitors/:id', async (req, res) => {
  const { id } = req.params;
  const owner = req.headers['x-channel'] as string;

  const monitorKey = ['monitors', owner, id];
  const monitor = await kv.get<Monitor>(monitorKey);

  if (!monitor.value) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  await kv.delete(monitorKey);

  res.status(204).send();
});

// Endpoint para listar todos os logs de um monitor
app.get('/monitors/:id/logs', async (req, res) => {
  const { id } = req.params;
  const owner = req.headers['x-channel'] as string;
  const logs: MonitorLog[] = [];

  const records = kv.list({ prefix: ['monitor-logs', owner, id] });
  for await (const entry of records) {
    logs.push(entry.value as MonitorLog);
  }

  res.json(logs);
});

// Endpoint para adicionar um log a um monitor
app.post('/monitors/:id/logs', async (req, res) => {
  const { id } = req.params;
  const { statusCode, responseTime, data } = req.body;
  const owner = req.headers['x-channel'] as string;

  if (!statusCode || !responseTime || !data) {
    return res.status(400).json({ error: 'Status code, response time, and data are required' });
  }

  const logId = v1.generate() as string;

  const log: MonitorLog = {
    id: logId,
    monitorId: id,
    statusCode,
    responseTime,
    owner,
    data,
    createdAt: new Date().toISOString(),
  };

  await kv.set(['monitor-logs', owner, id, logId], log);

  res.status(201).json(log);
});

app.post('/jobs/verify', async (req, res) => {
  const monitors = kv.list<Monitor>({ prefix: ['monitors'] })

  for await (const monitor of monitors) {
    await indier.job.publish({
      topic: 'monitor::verify',
      target: `${Deno.env.get('API_URL')}/jobs/verify/${monitor.value.id}`,
      method: 'POST',
    });
  }

  return res.status(200).json({ message: 'Monitors verified' });
});

app.post('/jobs/verify/:id', async (req, res) => {
  const { id } = req.params;

  const monitor = await kv.get<Monitor>(['monitors', id]);

  if (!monitor.value) {
    res.status(404).json({ error: 'Monitor not found' });
    return;
  }

  const startOfRequest = new Date();

  const response = await fetch(monitor.value.url, { method: monitor.value.method });

  const statusCode = response.status;

  const endOfRequest = new Date();
  const responseTime = endOfRequest.getTime() - startOfRequest.getTime();

  const logId = v1.generate() as string;

  const log: MonitorLog = {
    id: logId,
    monitorId: id,
    statusCode,
    responseTime,
    owner: monitor.value.owner,
    data: {
      body: await response.text(),
      headers: response.headers,
    },
    createdAt: new Date().toISOString(),
  };

  await kv.set(['monitor-logs', monitor.value.owner, id, logId], log);

  res.status(200).json({ message: 'Monitor verified and log created', data: { ...log } });
});

app.listen(Deno.env.get("PORT") || 3000, () => {
  console.log(`Server is running on port ${Deno.env.get("PORT") || 3000}`);
});
