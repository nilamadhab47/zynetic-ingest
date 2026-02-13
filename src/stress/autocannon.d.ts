declare module 'autocannon' {
  function autocannon(
    options: any,
    callback: (err: any, result: any) => void,
  ): any;

  namespace autocannon {
    function track(instance: any, options?: any): void;
  }

  export = autocannon;
}
