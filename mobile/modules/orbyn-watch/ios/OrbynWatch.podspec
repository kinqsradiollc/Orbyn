Pod::Spec.new do |s|
  s.name           = 'OrbynWatch'
  s.version        = '1.0.0'
  s.summary        = 'Bridge the Orbyn glance to the Apple Watch over WatchConnectivity.'
  s.description    = 'Local Expo module: the phone sends the glance the widget/Watch render.'
  s.author         = 'Orbyn'
  s.homepage       = 'https://github.com/kinqsradiollc/Orbyn'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
