import React from 'react'
import './Footer.css'
import { assets } from '../../assets/assets'

const Footer = () => {
  return (
    <div className='footer' id='footer'>
      <div className="footer-content">
        <div className="footer-content-left">
            <img src={assets.logo} alt="" />
            <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Vitae iusto blanditiis omnis eum ipsa officiis quae officia, assumenda harum quam accusantium, veniam quisquam tempora minus magnam aliquid fugiat! Eum, nulla et eos magni temporibus sit iusto est natus dignissimos. Aspernatur accusamus corporis consectetur dolorem.</p>
            <div className="footer-social-icons">
                <img src={assets.facebook_icon} alt="" />
                <img src={assets.twitter_icon} alt="" />
                <img src={assets.linkedin_icon} alt="" />
            </div>
        </div>
        <div className="footer-content-center">
            <h2>COMPANY</h2>
            <ul>
                <li>Home</li>
                <li>About us</li>
                <li>Delivery</li>
                <li>Privacy policy</li>
            </ul>
        </div>
        <div className="footer-content-right">
            <h2>GET IN TOUCH</h2>
            <ul>
                <li>+880-1811-7875-12</li>
                <li>udoychowdhury.cse.gub@gmail.com</li>
            </ul>
        </div> 
      </div>
      <hr />
      <p className="footer-copyright">
        Copyright 2025 &copy; Udoy Chowdhury - All Right Reserved.
      </p>
    </div>
  )
}

export default Footer
