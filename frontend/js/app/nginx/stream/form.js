const Mn = require('backbone.marionette');
const App = require('../../main');
const StreamModel = require('../../../models/stream');
const template = require('./form.ejs');
const dns_providers = require('../../../../../global/certbot-dns-plugins');

require('jquery-serializejson');
require('jquery-mask-plugin');
require('selectize');
const Helpers = require("../../../lib/helpers");
const certListItemTemplate = require("../certificates-list-item.ejs");
const i18n = require("../../i18n");
let wasRange = false;
module.exports = Mn.View.extend({
  template: template,
  className: 'modal-dialog',

  ui: {
    form: 'form',
    forwarding_host: 'input[name="forwarding_host"]',
    incoming_port_from: 'input[name="incoming_port_from"]',
    forwarding_port_from: 'input[name="forwarding_port_from"]',
    type_error: '.forward-type-error',
    buttons: '.modal-footer button',
    switches: '.custom-switch-input',
    cancel: 'button.cancel',
    save: 'button.save',
    le_error_info: '#le-error-info',
    certificate_select: 'select[name="certificate_id"]',
    domain_names: 'input[name="domain_names"]',
    dns_challenge_switch: 'input[name="meta[dns_challenge]"]',
    dns_challenge_content: '.dns-challenge',
    dns_provider: 'select[name="meta[dns_provider]"]',
    credentials_file_content: '.credentials-file-content',
    dns_provider_credentials: 'textarea[name="meta[dns_provider_credentials]"]',
    propagation_seconds: 'input[name="meta[propagation_seconds]"]',
    letsencrypt: '.letsencrypt'
  },

  events: {
    'change @ui.switches': function () {
      this.ui.type_error.hide();
    },

    'input @ui.incoming_port_from': function () {
      handlePortValidity(this.ui.incoming_port_from)
      handleForwardingPort(this.ui.forwarding_port_from,
          this.ui.incoming_port_from.val().trim())
    },

    'input @ui.forwarding_port_from': function () {
      handlePortValidity(this.ui.forwarding_port_from)
    },

    'click @ui.save': function (e) {
      e.preventDefault();

      if (!this.ui.form[0].checkValidity()) {
        $('<input type="submit">').hide().appendTo(
            this.ui.form).click().remove();
        return;
      }

      let view = this;
      let data = this.ui.form.serializeJSON();

      if (!data.tcp_forwarding && !data.udp_forwarding) {
        this.ui.type_error.show();
        return;
      }

      // Manipulate
      if (typeof data.incoming_port_from === 'string'
          && data.incoming_port_from.includes('-')) {
        let parts = data.incoming_port_from.split('-').map(
            p => parseInt(p.trim(), 10));
        if (isValidPortRange(data.incoming_port_from)) {
          data.incoming_port_from = parts[0];
          data.incoming_port_to = parts[1];
          data.forwarding_port_from = parts[0];
          data.forwarding_port_to = parts[1];
        } else {
          alert(i18n('streams', 'invalid-port-range'));
          return;
        }
      } else {
        const port = parseInt(data.incoming_port_from, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          alert(i18n('streams', 'invalid-port'));
          return;
        }

        data.incoming_port_from = port
        data.forwarding_port_from = parseInt(data.forwarding_port_from, 10);
      }

      data.tcp_forwarding = !!data.tcp_forwarding;
      data.udp_forwarding = !!data.udp_forwarding;

      if (typeof data.meta === 'undefined') {
        data.meta = {};
      }
      data.meta.letsencrypt_agree = data.meta.letsencrypt_agree == 1;
      data.meta.dns_challenge = true;

      if (data.meta.propagation_seconds
          === '') {
        data.meta.propagation_seconds = undefined;
      }

      if (typeof data.domain_names === 'string' && data.domain_names) {
        data.domain_names = data.domain_names.split(',');
      }

      // Check for any domain names containing wildcards, which are not allowed with letsencrypt
      if (data.certificate_id === 'new') {
        let domain_err = false;
        if (!data.meta.dns_challenge) {
          data.domain_names.map(function (name) {
            if (name.match(/\*/im)) {
              domain_err = true;
            }
          });
        }

        if (domain_err) {
          alert(i18n('ssl', 'no-wildcard-without-dns'));
          return;
        }
      } else {
        data.certificate_id = parseInt(data.certificate_id, 10);
      }

      let method = App.Api.Nginx.Streams.create;
      let is_new = true;

      if (this.model.get('id')) {
        // edit
        is_new = false;
        method = App.Api.Nginx.Streams.update;
        data.id = this.model.get('id');
      }

      this.ui.buttons.prop('disabled', true).addClass('btn-disabled');
      method(data)
      .then(result => {
        view.model.set(result);

        App.UI.closeModal(function () {
          if (is_new) {
            App.Controller.showNginxStream();
          }
        });
      })
      .catch(err => {
        let more_info = '';
        if (err.code === 500 && err.debug) {
          try {
            more_info = JSON.parse(err.debug).debug.stack.join("\n");
          } catch (e) {
          }
        }
        this.ui.le_error_info[0].innerHTML = `${err.message}${more_info !== ''
            ? `<pre class="mt-3">${more_info}</pre>` : ''}`;
        this.ui.le_error_info.show();
        this.ui.le_error_info[0].scrollIntoView();
        this.ui.buttons.prop('disabled', false).removeClass('btn-disabled');
        this.ui.save.removeClass('btn-loading');
      });
    },

    'change @ui.certificate_select': function () {
      let id = this.ui.certificate_select.val();
      if (id === 'new') {
        this.ui.letsencrypt.show().find('input').prop('disabled', false);
        this.ui.domain_names.prop('required', 'required');

        this.ui.dns_challenge_switch
        .prop('disabled', true)
        .parents('.form-group')
        .css('opacity', 0.5);

        this.ui.dns_provider.prop('required', 'required');
        const selected_provider = this.ui.dns_provider[0].options[this.ui.dns_provider[0].selectedIndex].value;
        if (selected_provider != ''
            && dns_providers[selected_provider].credentials !== false) {
          this.ui.dns_provider_credentials.prop('required', 'required');
        }
        this.ui.dns_challenge_content.show();
      } else {
        this.ui.letsencrypt.hide().find('input').prop('disabled', true);
      }
    },

    'change @ui.dns_provider': function () {
      const selected_provider = this.ui.dns_provider[0].options[this.ui.dns_provider[0].selectedIndex].value;
      if (selected_provider != ''
          && dns_providers[selected_provider].credentials !== false) {
        this.ui.dns_provider_credentials.prop('required', 'required');
        this.ui.dns_provider_credentials[0].value = dns_providers[selected_provider].credentials;
        this.ui.credentials_file_content.show();
      } else {
        this.ui.dns_provider_credentials.prop('required', false);
        this.ui.credentials_file_content.hide();
      }
    },
  },

  templateContext: {
    getLetsencryptEmail: function () {
      return App.Cache.User.get('email');
    },
    getDnsProvider: function () {
      return typeof this.meta.dns_provider !== 'undefined'
      && this.meta.dns_provider != '' ? this.meta.dns_provider : null;
    },
    getDnsProviderCredentials: function () {
      return typeof this.meta.dns_provider_credentials !== 'undefined'
          ? this.meta.dns_provider_credentials : '';
    },
    getPropagationSeconds: function () {
      return typeof this.meta.propagation_seconds !== 'undefined'
          ? this.meta.propagation_seconds : '';
    },
    dns_plugins: dns_providers,
  },

  onRender: function () {
    let view = this;

    // Certificates
    this.ui.le_error_info.hide();
    this.ui.dns_challenge_content.hide();
    this.ui.credentials_file_content.hide();
    this.ui.letsencrypt.hide();
    this.ui.certificate_select.selectize({
      valueField: 'id',
      labelField: 'nice_name',
      searchField: ['nice_name', 'domain_names'],
      create: false,
      preload: true,
      allowEmptyOption: true,
      render: {
        option: function (item) {
          item.i18n = App.i18n;
          item.formatDbDate = Helpers.formatDbDate;
          return certListItemTemplate(item);
        }
      },
      load: function (query, callback) {
        App.Api.Nginx.Certificates.getAll()
        .then(rows => {
          callback(rows);
        })
        .catch(err => {
          console.error(err);
          callback();
        });
      },
      onLoad: function () {
        view.ui.certificate_select[0].selectize.setValue(
            view.model.get('certificate_id'));
      }
    });

    handleForwardingPort(this.ui.forwarding_port_from,
        this.ui.incoming_port_from.val().trim())
  },

  initialize: function (options) {
    if (typeof options.model === 'undefined' || !options.model) {
      this.model = new StreamModel.Model();
    }
  }
})

function isValidPort(port_value) {
  let port_value_int = port_value
  if (typeof port_value === 'string') {
    port_value_int = parseInt(port_value.trim(), 10)
  }

  return Number.isInteger(port_value_int) && port_value_int >= 1
      && port_value_int <= 65535;
}

function isValidPortRange(port_range_string) {
  let parts = port_range_string.split('-').map(p => parseInt(p.trim(), 10));

  return parts.length === 2 &&
      isValidPort(parts[0]) &&
      isValidPort(parts[1]) &&
      parts[0] < parts[1];
}

function handlePortValidity(input_element) {
  let port_value = input_element.val().trim()
  const isRange = port_value.includes('-');

  if (isRange) {
    if (!isValidPortRange(port_value)) {
      input_element[0].setCustomValidity(i18n('streams', 'invalid-port-range'))
    } else {
      input_element[0].setCustomValidity('');
    }
  } else {
    if (!isValidPort(port_value)) {
      input_element[0].setCustomValidity(i18n('streams', 'invalid-port'))
    } else {
      input_element[0].setCustomValidity('');
    }
  }
  input_element[0].reportValidity()
}

function handleForwardingPort(input_element, incoming_port_value) {
  const isRange = incoming_port_value.includes('-');

  if (isRange) {
    // Set and disable forwarding_port_from if a range is entered
    input_element.prop('disabled', false);
    input_element.val(incoming_port_value);
    input_element.prop('disabled', true);
    wasRange = true;
  } else {
    // When going from a range to a single port, clear once
    if (wasRange) {
      input_element.prop('disabled', false);
      input_element.val('');
      wasRange = false;
    }

    input_element.prop('disabled', false);
  }
}

