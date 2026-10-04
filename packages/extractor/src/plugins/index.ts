import type { Plugin } from './types.js';
import { aspnetcore } from './aspnetcore.js';
import { spring } from './spring.js';
import { express } from './express.js';
import { nestjs } from './nestjs.js';
import { httpClients } from './http-clients.js';
import { kafka } from './kafka.js';
import { rabbitmq } from './rabbitmq.js';

export const ALL_PLUGINS: Plugin[] = [aspnetcore, spring, express, nestjs, httpClients, kafka, rabbitmq];
export type { Plugin, PluginContext } from './types.js';
