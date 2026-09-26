Pod::Spec.new do |s|
  s.name           = 'OrbynQuickActions'
  s.version        = '1.0.0'
  s.summary        = 'Hand the app icon quick actions to Orbyn as the orbyn:// links they carry.'
  s.description    = 'Local Expo module: long-press the icon for New task, Today’s agenda, Scan notes or Ask assistant.'
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
