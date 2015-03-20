/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

QUnit.test('Submitter test', function( assert ) {

  // Test chaining promises and maintaining order
  (function() {
    var results = [];
    var submit = submitterFn();
    submit.then(createSleepPromise.bind(this, 3000, 1, results));
    submit.then(createSleepPromise.bind(this, 10, 2, results));
    submit(null, null, function() {
      assert.deepEqual(results, [1,2],
          "Submitter execute promises in expected order");
    });
  })();

  // Test rejection behavior by letting first promise fail and expect the second
  // one not to run.
  (function() {
    var results = [];
    var submit = submitterFn();
    submit.then(createSleepPromise.bind(this, 3000, 1, results, true));
    submit.then(createSleepPromise.bind(this, 10, 2, results));
    submit.then(function() {
      // This should not be executed and will raise an error.
      assert.ok(false,
          "Submitter doesn't execute functions if earlier promise fails");
    });
    // Add result check as error callback
    submit(null, null, null, false, false, function() {
      assert.deepEqual(results, [],
          "Submitter resets if earlier promise fails");
      done();
    });
  })();

  /**
   * Busy wait for some defined time.
   */
  function sleep(milliseconds) {
    var start = new Date().getTime();
    for (var i = 0; i < 1e7; i++) {
      if ((new Date().getTime() - start) > milliseconds){
        break;
      }
    }
  }

  /**
  * Creates a promise that will sleep for some time before it is resolved. The
  * promise will write their value to the resilts array passed as argument
  * when they are executed. The promise is rejected if fail is truthy.
  */
  function createSleepPromise(milliseconds, value, results, fail) {
    return new Promise(function(resolve, reject) {
      if (fail) {
        reject("I was asked to fail");
      } else {
        sleep(milliseconds);
        results.push(value);
        resolve();
      }
    });
  }

});
