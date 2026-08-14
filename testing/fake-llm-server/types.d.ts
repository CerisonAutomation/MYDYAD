declare module "express" {
  import { IncomingMessage, ServerResponse } from "http";

  interface Request extends IncomingMessage {
    body?: any;
    params?: Record<string, string>;
    query?: Record<string, string | string[] | undefined>;
  }

  interface Response extends ServerResponse {
    send(body?: string | Buffer | object): this;
    json(body?: any): this;
    status(code: number): this;
    type(contentType: string): this;
    sendFile(path: string): void;
    redirect(url: string): void;
    set(field: string, value: string): this;
    append(field: string, value: string): this;
  }

  interface Router {
    get(path: string, handler: (req: Request, res: Response) => void): void;
    post(path: string, handler: (req: Request, res: Response) => void): void;
    put(path: string, handler: (req: Request, res: Response) => void): void;
    delete(path: string, handler: (req: Request, res: Response) => void): void;
    use(handler: (req: Request, res: Response, next: () => void) => void): void;
  }

  interface Application extends Router {
    listen(port: number, callback?: () => void): void;
    use(middleware: any): void;
  }

  function express(): Application;

  namespace express {
    type Request = Request;
    type Response = Response;
    type Router = Router;
    type Application = Application;
  }

  export = express;
}

declare module "cors" {
  function cors(options?: any): any;
  export = cors;
}
