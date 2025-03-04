/*

This file is part of the plugin Checkout with Vipps for WooCommerce
Copyright (c) 2019 WP-Hosting AS

MIT License

Copyright (c) 2019 WP-Hosting AS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/



jQuery( document ).ready( function() {
    // This gets loaded conditionally when the Vipps Checkout page is used IOK 2021-08-25
    var pollingdone=false;
    var polling=false;
    var listening=false;
    var initiating=false;

    // Just in case we need to do this by button.
    jQuery('.vipps_checkout_button.button').click(function (e) { initVippsCheckout() });
    if (jQuery('.vipps_checkout_startdiv').length>0) {
       // which we must if we don't have the visibility API
      if (typeof document.hidden == "undefined") {
         jQuery('.vipps_checkout_startdiv').css('visibility', 'visible');
      } else {
         document.addEventListener('visibilitychange', initWhenVisible, false);
         initWhenVisible();
      }
    }


    function initVippsCheckout () {
      if (initiating) return;
      initiating=true;
      jQuery("body").css("cursor", "progress");
      jQuery("body").addClass('processing');

      jQuery('.vipps_checkout_button.button').each(function () {
           jQuery(this).addClass('disabled');
           jQuery(this).css("cursor", "progress");
      });

      // Try to start Vipps Checkout with any session provided.
      function doVippsCheckout() {
         console.log("In session state thing");
         if (!VippsSessionState) return false;
         let args = { 
                     checkoutFrontendUrl: VippsSessionState['checkoutFrontendUrl'].replace(/\/$/, ''),
                     token:  VippsSessionState['token'],
                     iFrameContainerId: "vippscheckoutframe",
                     language: VippsConfig['vippslanguage']
         };
         let vippsCheckout = VippsCheckout(args);
         console.log("Started with %j", args);
         jQuery("body").css("cursor", "default");
         jQuery('.vipps_checkout_button.button').css("cursor", "default");
         jQuery('.vipps_checkout_startdiv').hide();
         listenToFrame();
         return true;
      }

      if (!doVippsCheckout()) {
          jQuery.ajax(VippsConfig['vippsajaxurl'],
                    {   cache:false,
                        timeout: 0,
                        dataType:'json',
                        data: { 'action': 'vipps_checkout_start_session', 'vipps_checkout_sec' : jQuery('#vipps_checkout_sec').val() },
                        method: 'POST', 
                        error: function (xhr, statustext, error) {
                            jQuery("body").css("cursor", "default");
                            jQuery('.vipps_checkout_button.button').css("cursor", "default");
                            jQuery('.vipps_checkout_startdiv').hide();
                            console.log('Error initiating transaction : ' + statustext + ' : ' + error);
                            pollingdone=true;
                            jQuery("body").removeClass('processing');
                            jQuery('#vippscheckouterror').show();
                            jQuery('#vippscheckoutframe').html('<div style="display:none">Error occured</div>');
                            if (error == 'timeout')  {
                                console.log('Timeout creating Checkout session at vipps');
                            }
                        },
                        'success': function (result,statustext, xhr) {
                            jQuery("body").css("cursor", "default");
                            jQuery('.vipps_checkout_button.button').css("cursor", "default");
                            jQuery('.vipps_checkout_startdiv').hide();
    
                            if (! result['data']['ok']) {
                                console.log("Error starting Vipps Checkout %j", result);
                                jQuery('#vippscheckouterror').show();
                                jQuery("body").removeClass('processing');
                                return;
                            }
                            if (result['data']['redirect']) {
                                window.location.replace(result['redirect']);
                                return;
                            }
                            if (result['data']['src']) {
                                VippsSessionState = { token: result['data']['token'], checkoutFrontendUrl: result['data']['src'] }
                                doVippsCheckout();
                            }
                        },
                    });
        }
    }


    function listenToFrame() {
        if (listening) return;
        var iframe = jQuery('#vippscheckoutframe iframe');
        if (iframe.length < 1) return;
        var src = iframe.attr('src');
        if (!src) return;
        listening = true;
        var origin = new URL(src).origin;
        window.addEventListener( 'message',
                // Only frameHeight in pixels are sent, but it is sent whenever the frame changes (so, including when address etc is set). 
                // So poll when this happens. IOK 2021-08-25
                function (e) {
                    if (e.origin != origin) return;
                    jQuery("body").removeClass('processing');
                    if (!polling && !pollingdone) pollSessionStatus();
                    },
                    false
                );
    }

    function pollSessionStatus () {
        if (polling) return;
        polling=true;

        if (typeof wp !== 'undefined' && typeof wp.hooks !== 'undefined') {
                    wp.hooks.doAction('vippsCheckoutPollingStart');
        }

        jQuery.ajax(VippsConfig['vippsajaxurl'],
                {cache:false,
                    timeout: 0,
                    dataType:'json',
                    data: { 'action': 'vipps_checkout_poll_session', 'vipps_checkout_sec' : jQuery('#vipps_checkout_sec').val() },
                    error: function (xhr, statustext, error) {
                        // This may happen as a result of a race condition where the user is sent to Vipps
                        //  when the "poll" call still hasn't returned. In this case this error doesn't actually matter, 
                        // It may also be a temporary error, so we do not interrupt polling or notify the user. Just log.
                        // IOK 2022-04-06
                        if (error == 'timeout')  {
                            console.log('Timeout polling session data hos Vipps');
                        } else {
                            console.log('Error polling session data hos Vipps - this may be temporary or because the user has moved on: ' + statustext + " error: " + error);
                        }
                    },
                    'complete': function (xhr, statustext, error)  {
                        polling = false;
                        if (!pollingdone) {
                            // In case of race conditions, poll at least every 5 seconds 
                            setTimeout(pollSessionStatus, 10000);
                        }
                    },
                    method: 'POST', 
                    'success': function (result,statustext, xhr) {
                        console.log('Ok: ' + result['success'] + ' message ' + result['data']['msg'] + ' url ' + result['data']['url']);
                        if (result['data']['msg'] == 'EXPIRED') {
                            jQuery('#vippscheckoutexpired').show();
                            jQuery('#vippscheckoutframe').html('<div style="display:none">Session expired</div>');
                            pollingdone=true;
                            return;
                        }
                        if (result['data']['msg'] == 'ERROR' || result['data']['msg'] == 'FAILED') {
                            jQuery('#vippscheckouterror').show();
                            jQuery('#vippscheckoutframe').html('<div style="display:none">Error occured in backend</div>');
                            pollingdone=true;
                            return;
                        }
                        if (result['data']['url']) {
                            pollingdone = 1;
                            window.location.replace(result['data']['url']);
                        }
                    },
                });
    }



    function initWhenVisible() {
      if (typeof document.visibilityState == 'undefined') return;
      if (initiating) return;
      if (listening) return;
      if (document.visibilityState == 'visible') {
         jQuery("body").addClass('processing');
         initVippsCheckout();
      } else {
         console.log("Not visible - not starting Vipps Checkout");
      }
    }

    console.log("Vipps Checkout Initialized version 110");
    
    listenToFrame(); // Start now if we have an iframe. This will also start the polling.
    initWhenVisible(); // Or start the session maybe
});
