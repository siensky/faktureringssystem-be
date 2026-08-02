import { fastify, type FastifyInstance } from "fastify";
import errorHandler from "./error/errorHandler";
import postgres from "@fastify/postgres";



const fastifyServer: FastifyInstance = fastify({ logger: true });

async function start() {

    await fastifyServer.register(postgres, {
        connectionString: process.env.DATABASE_URL,
    
      });

  errorHandler(fastifyServer);


  const port = Number(process.env.PORT) || 4000;

  await fastifyServer.listen({
    host: "0.0.0.0",
    port,
  });
}

start();
