Pod::Spec.new do |s|
  s.name = 'OrbynChatgpt'
  s.version = '1.0.0'
  s.summary = 'Device-local ChatGPT OAuth callback for Orbyn.'
  s.description = 'Loopback authorization listener; no hosted token storage.'
  s.author = 'Orbyn'
  s.homepage = 'https://github.com/kinqsradiollc/Orbyn'
  s.license = 'MIT'
  s.platforms = { :ios => '15.1' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
